/**
 * ============================================================================
 * discover-glb.mjs
 * ----------------------------------------------------------------------------
 * Phase 0 discovery probe for the junkyard tile set.
 *
 * Zero-dependency (Node built-ins only) inspector for a .glb file. Parses the
 * GLB container + embedded glTF JSON and reports, per mesh node:
 *   - name (validated against the jyt_ naming convention)
 *   - local-space bbox (from POSITION accessor min/max)
 *   - world-space bbox (node TRS chain applied)
 *   - node translation (the Blender grid offset we will discard / re-zero)
 *   - footprint check (expect 3 x h x 3, h in {1,2,3})
 *   - UV (TEXCOORD_0) + material presence
 *
 * It also computes cross-tile aggregates used to answer:
 *   - Did Blender Z-up export convert to glTF Y-up correctly?
 *   - Do all tiles share a common flat base axis (the re-zero anchor)?
 *
 * Usage:  node scripts/discover-glb.mjs [path/to/file.glb]
 * ============================================================================
 */

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));

/** Naming convention: jyt_{flat|ramp}_{dir}_{lvl}[_to_{lvl}] where lvl uses '.' as '/'. */
const NAME_RE =
	/^jyt_(flat|ramp)_(n|ne|e|se|s|sw|w|nw)?_?(0|1\.3|2\.3|3\.3)(?:_to_(0|1\.3|2\.3|3\.3))?$/;

const FOOTPRINT = 3; // expected X/Z footprint in meters
const EPS = 1e-4; // tolerance for float comparisons on measured geometry

/**
 * Parse a GLB buffer into its JSON chunk (the glTF document).
 * @param {Buffer} buf Raw .glb file bytes.
 * @returns {object} Parsed glTF JSON document.
 */
function parseGlb(buf) {
	const magic = buf.readUInt32LE(0);
	if (magic !== 0x46546c67) {
		throw new Error("Not a GLB file (bad magic).");
	}
	const version = buf.readUInt32LE(4);
	let offset = 12;
	let json = null;
	while (offset < buf.length) {
		const chunkLen = buf.readUInt32LE(offset);
		const chunkType = buf.readUInt32LE(offset + 4);
		const start = offset + 8;
		const data = buf.subarray(start, start + chunkLen);
		if (chunkType === 0x4e4f534a) {
			json = JSON.parse(data.toString("utf8"));
		}
		offset = start + chunkLen;
	}
	if (!json) {
		throw new Error("No JSON chunk found in GLB.");
	}
	return { version, json };
}

/**
 * Build a 4x4 column-major matrix from a node's TRS or explicit matrix.
 * @param {object} node A glTF node.
 * @returns {number[]} 16-element column-major matrix.
 */
function nodeMatrix(node) {
	if (node.matrix) {
		return node.matrix.slice();
	}
	const t = node.translation || [0, 0, 0];
	const r = node.rotation || [0, 0, 0, 1]; // xyzw quaternion
	const s = node.scale || [1, 1, 1];
	return compose(t, r, s);
}

/**
 * Compose a column-major TRS matrix.
 * @param {number[]} t translation [x,y,z].
 * @param {number[]} r quaternion [x,y,z,w].
 * @param {number[]} s scale [x,y,z].
 * @returns {number[]} 16-element column-major matrix.
 */
function compose(t, r, s) {
	const [x, y, z, w] = r;
	const x2 = x + x, y2 = y + y, z2 = z + z;
	const xx = x * x2, xy = x * y2, xz = x * z2;
	const yy = y * y2, yz = y * z2, zz = z * z2;
	const wx = w * x2, wy = w * y2, wz = w * z2;
	const [sx, sy, sz] = s;
	return [
		(1 - (yy + zz)) * sx, (xy + wz) * sx, (xz - wy) * sx, 0,
		(xy - wz) * sy, (1 - (xx + zz)) * sy, (yz + wx) * sy, 0,
		(xz + wy) * sz, (yz - wx) * sz, (1 - (xx + yy)) * sz, 0,
		t[0], t[1], t[2], 1,
	];
}

/**
 * Multiply two column-major 4x4 matrices (a * b).
 * @param {number[]} a left matrix.
 * @param {number[]} b right matrix.
 * @returns {number[]} product.
 */
function multiply(a, b) {
	const out = new Array(16).fill(0);
	for (let c = 0; c < 4; c++) {
		for (let r = 0; r < 4; r++) {
			let sum = 0;
			for (let k = 0; k < 4; k++) {
				sum += a[k * 4 + r] * b[c * 4 + k];
			}
			out[c * 4 + r] = sum;
		}
	}
	return out;
}

/**
 * Transform a point by a column-major matrix (w=1).
 * @param {number[]} m matrix.
 * @param {number[]} p point [x,y,z].
 * @returns {number[]} transformed point.
 */
function transformPoint(m, p) {
	const [x, y, z] = p;
	return [
		m[0] * x + m[4] * y + m[8] * z + m[12],
		m[1] * x + m[5] * y + m[9] * z + m[13],
		m[2] * x + m[6] * y + m[10] * z + m[14],
	];
}

/**
 * Resolve each node's parent so we can compose world matrices.
 * @param {object} gltf glTF document.
 * @returns {Map<number, number>} childIndex -> parentIndex.
 */
function buildParentMap(gltf) {
	const parent = new Map();
	(gltf.nodes || []).forEach((n, i) => {
		(n.children || []).forEach((c) => parent.set(c, i));
	});
	return parent;
}

/**
 * Compose a node's world matrix by walking its parent chain.
 * @param {object} gltf glTF document.
 * @param {Map<number, number>} parentMap child->parent.
 * @param {number} index node index.
 * @returns {number[]} world matrix.
 */
function worldMatrix(gltf, parentMap, index) {
	const chain = [];
	let cur = index;
	while (cur !== undefined) {
		chain.push(cur);
		cur = parentMap.get(cur);
	}
	chain.reverse();
	let m = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
	for (const ni of chain) {
		m = multiply(m, nodeMatrix(gltf.nodes[ni]));
	}
	return m;
}

/** @param {number} n @returns {string} fixed 3-decimal string. */
const f = (n) => (Object.is(n, -0) ? 0 : n).toFixed(3);
/** @param {number[]} v @returns {string} formatted vec3. */
const vec = (v) => `[${f(v[0])}, ${f(v[1])}, ${f(v[2])}]`;

/**
 * Main discovery routine.
 * @returns {void}
 */
function main() {
	const argPath = process.argv[2];
	const glbPath = argPath
		? resolve(process.cwd(), argPath)
		: resolve(__dirname, "..", "assets", "models", "jy_parts_v001.glb");

	const buf = readFileSync(glbPath);
	const { version, json: gltf } = parseGlb(buf);
	const parentMap = buildParentMap(gltf);
	const accessors = gltf.accessors || [];
	const meshes = gltf.meshes || [];
	const materials = gltf.materials || [];

	const rows = [];
	const baseAtZero = { x: 0, y: 0, z: 0 }; // how many tiles have local-min ~0 on each axis
	const nameIssues = [];
	const footprintIssues = [];
	const missingUV = [];
	const missingMat = [];
	const seenNames = new Map();

	(gltf.nodes || []).forEach((node, index) => {
		if (node.mesh === undefined) {
			return;
		}
		const mesh = meshes[node.mesh];
		const name = node.name || mesh.name || `node_${index}`;

		// Local-space aabb across all primitives via POSITION accessor min/max.
		let lmin = [Infinity, Infinity, Infinity];
		let lmax = [-Infinity, -Infinity, -Infinity];
		let hasUV = false;
		let hasMat = false;
		for (const prim of mesh.primitives) {
			const posIdx = prim.attributes.POSITION;
			const acc = accessors[posIdx];
			if (acc && acc.min && acc.max) {
				for (let i = 0; i < 3; i++) {
					lmin[i] = Math.min(lmin[i], acc.min[i]);
					lmax[i] = Math.max(lmax[i], acc.max[i]);
				}
			}
			if (prim.attributes.TEXCOORD_0 !== undefined) {
				hasUV = true;
			}
			if (prim.material !== undefined) {
				hasMat = true;
			}
		}

		const wm = worldMatrix(gltf, parentMap, index);
		// World aabb from the 8 transformed local corners.
		let wmin = [Infinity, Infinity, Infinity];
		let wmax = [-Infinity, -Infinity, -Infinity];
		for (let cx = 0; cx < 2; cx++) {
			for (let cy = 0; cy < 2; cy++) {
				for (let cz = 0; cz < 2; cz++) {
					const p = transformPoint(wm, [
						cx ? lmax[0] : lmin[0],
						cy ? lmax[1] : lmin[1],
						cz ? lmax[2] : lmin[2],
					]);
					for (let i = 0; i < 3; i++) {
						wmin[i] = Math.min(wmin[i], p[i]);
						wmax[i] = Math.max(wmax[i], p[i]);
					}
				}
			}
		}

		const lsize = [lmax[0] - lmin[0], lmax[1] - lmin[1], lmax[2] - lmin[2]];
		const wsize = [wmax[0] - wmin[0], wmax[1] - wmin[1], wmax[2] - wmin[2]];
		const translation = node.translation || [0, 0, 0];

		// Aggregates (use world size: post-import orientation).
		["x", "y", "z"].forEach((ax, i) => {
			if (Math.abs(wmin[i]) < EPS) {
				baseAtZero[ax]++;
			}
		});

		// Name validation.
		if (!NAME_RE.test(name)) {
			nameIssues.push(name);
		}
		seenNames.set(name, (seenNames.get(name) || 0) + 1);

		// Footprint: two of the world dims should be ~3 (X/Z), height in {1,2,3}.
		const near = (a, b) => Math.abs(a - b) < 0.05;
		const footOk =
			near(wsize[0], FOOTPRINT) &&
			near(wsize[2], FOOTPRINT) &&
			[1, 2, 3].some((h) => near(wsize[1], h));
		if (!footOk) {
			footprintIssues.push(`${name}  world size ${vec(wsize)}`);
		}
		if (!hasUV) {
			missingUV.push(name);
		}
		if (!hasMat) {
			missingMat.push(name);
		}

		rows.push({
			name,
			nameOk: NAME_RE.test(name),
			lsize,
			wsize,
			wmin,
			translation,
			hasUV,
			hasMat,
		});
	});

	// ---- Report ------------------------------------------------------------
	console.log("=".repeat(78));
	console.log(`GLB: ${glbPath}`);
	console.log(`glTF asset version (container): ${version}`);
	console.log(`generator: ${gltf.asset?.generator || "unknown"}`);
	console.log(`mesh nodes: ${rows.length}  |  materials: ${materials.length}`);
	console.log("=".repeat(78));

	console.log("\nPER-TILE (world = post-import ThreeJS orientation):");
	console.log(
		[
			"name".padEnd(30),
			"ok",
			"worldSize".padEnd(24),
			"worldMin".padEnd(24),
			"nodeTranslation",
		].join(" ")
	);
	for (const r of rows) {
		console.log(
			[
				r.name.padEnd(30),
				r.nameOk ? " ✓" : " ✗",
				vec(r.wsize).padEnd(24),
				vec(r.wmin).padEnd(24),
				vec(r.translation),
				r.hasUV ? "" : " [noUV]",
				r.hasMat ? "" : " [noMat]",
			].join(" ")
		);
	}

	console.log("\n" + "-".repeat(78));
	console.log("AGGREGATE FINDINGS");
	console.log("-".repeat(78));
	console.log(`Local-min ~0 per axis (re-zero anchor candidates): ${JSON.stringify(baseAtZero)}`);
	console.log(
		`  -> The axis where (almost) every tile sits at 0 is the shared base plane; ` +
			`combined with the min corner it gives us the canonical re-zero origin.`
	);

	const dupes = [...seenNames.entries()].filter(([, c]) => c > 1);
	console.log(`\nName convention failures: ${nameIssues.length}`);
	nameIssues.forEach((n) => console.log(`  ✗ ${n}`));
	console.log(`Duplicate names: ${dupes.length}`);
	dupes.forEach(([n, c]) => console.log(`  ⚠ ${n} x${c}`));
	console.log(`Footprint anomalies (not 3 x {1,2,3} x 3): ${footprintIssues.length}`);
	footprintIssues.forEach((s) => console.log(`  ⚠ ${s}`));
	console.log(`Tiles missing UVs: ${missingUV.length}${missingUV.length ? "  " + missingUV.join(", ") : ""}`);
	console.log(`Tiles missing material: ${missingMat.length}${missingMat.length ? "  " + missingMat.join(", ") : ""}`);
	console.log("\nDone.");
}

main();
