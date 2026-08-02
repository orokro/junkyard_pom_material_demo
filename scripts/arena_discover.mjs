/**
 * ============================================================================
 * arena_discover.mjs
 * ----------------------------------------------------------------------------
 * Discovery probe for the Arena POC building blocks (assets/models/arena_parts.glb).
 *
 * Sibling to discover-glb.mjs (junkyard). Zero-dependency (Node built-ins only).
 * For every mesh node under the `ArenaParts` root it reports, in POST-IMPORT
 * (Y-up / ThreeJS) world axes:
 *   - world size (X/Y/Z extents in meters)
 *   - the node ORIGIN (= the piece's pivot) position relative to its own bbox
 *   - a human classification of the pivot on each axis (min-edge / center /
 *     max-edge / bottom / top) so we can confirm "bottom-center", "cell-center",
 *     "north-edge", etc.
 *   - footprint in 4 m grid cells (rounded)
 *
 * Axis convention (to confirm against these numbers): +X = east, +Z = south,
 * -Z = north, +Y = up.
 *
 * Usage:  node scripts/arena_discover.mjs [path/to/file.glb]
 *         (defaults to assets/models/arena_parts.glb)
 * ============================================================================
 */

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const CELL = 4; // grid cell size (meters)
const EPS = 0.06; // tolerance for pivot/size classification

/** @param {Buffer} buf @returns {{version:number, json:object}} */
function parseGlb(buf) {
	if (buf.readUInt32LE(0) !== 0x46546c67) throw new Error("Not a GLB (bad magic).");
	const version = buf.readUInt32LE(4);
	let offset = 12;
	let json = null;
	while (offset < buf.length) {
		const chunkLen = buf.readUInt32LE(offset);
		const chunkType = buf.readUInt32LE(offset + 4);
		const start = offset + 8;
		const data = buf.subarray(start, start + chunkLen);
		if (chunkType === 0x4e4f534a) json = JSON.parse(data.toString("utf8"));
		offset = start + chunkLen;
	}
	if (!json) throw new Error("No JSON chunk in GLB.");
	return { version, json };
}

/** @param {object} node @returns {number[]} column-major matrix */
function nodeMatrix(node) {
	if (node.matrix) return node.matrix.slice();
	return compose(node.translation || [0, 0, 0], node.rotation || [0, 0, 0, 1], node.scale || [1, 1, 1]);
}

/** @param {number[]} t @param {number[]} r @param {number[]} s @returns {number[]} */
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

/** @param {number[]} a @param {number[]} b @returns {number[]} */
function multiply(a, b) {
	const out = new Array(16).fill(0);
	for (let c = 0; c < 4; c++)
		for (let r = 0; r < 4; r++) {
			let sum = 0;
			for (let k = 0; k < 4; k++) sum += a[k * 4 + r] * b[c * 4 + k];
			out[c * 4 + r] = sum;
		}
	return out;
}

/** @param {number[]} m @param {number[]} p @returns {number[]} */
function transformPoint(m, p) {
	const [x, y, z] = p;
	return [
		m[0] * x + m[4] * y + m[8] * z + m[12],
		m[1] * x + m[5] * y + m[9] * z + m[13],
		m[2] * x + m[6] * y + m[10] * z + m[14],
	];
}

/** @param {object} gltf @returns {Map<number,number>} child->parent */
function buildParentMap(gltf) {
	const parent = new Map();
	(gltf.nodes || []).forEach((n, i) => (n.children || []).forEach((c) => parent.set(c, i)));
	return parent;
}

/** @param {object} gltf @param {Map<number,number>} pm @param {number} index @returns {number[]} */
function worldMatrix(gltf, pm, index) {
	const chain = [];
	let cur = index;
	while (cur !== undefined) {
		chain.push(cur);
		cur = pm.get(cur);
	}
	chain.reverse();
	let m = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
	for (const ni of chain) m = multiply(m, nodeMatrix(gltf.nodes[ni]));
	return m;
}

const f = (n) => (Object.is(n, -0) ? 0 : n).toFixed(2);
const vec = (v) => `[${f(v[0])}, ${f(v[1])}, ${f(v[2])}]`;

/**
 * Classify where the origin sits along one axis of the bbox.
 * @param {number} originToMin origin - min (distance from min face to pivot).
 * @param {number} size extent on this axis.
 * @param {"x"|"y"|"z"} axis
 * @returns {string}
 */
function classify(originToMin, size, axis) {
	const half = size / 2;
	if (Math.abs(originToMin) < EPS) return axis === "y" ? "bottom(min)" : "min";
	if (Math.abs(originToMin - size) < EPS) return axis === "y" ? "top(max)" : "max";
	if (Math.abs(originToMin - half) < EPS) return "center";
	return `+${f(originToMin)} from min`;
}

function main() {
	const argPath = process.argv[2];
	const glbPath = argPath ? resolve(process.cwd(), argPath) : resolve(__dirname, "..", "assets", "models", "arena_parts.glb");
	const { json: gltf } = parseGlb(readFileSync(glbPath));
	const parentMap = buildParentMap(gltf);
	const accessors = gltf.accessors || [];
	const meshes = gltf.meshes || [];

	// Find the ArenaParts root + its direct children (for a clean tree view).
	const rootIdx = (gltf.nodes || []).findIndex((n) => (n.name || "") === "ArenaParts");
	const rootChildren = rootIdx >= 0 ? new Set(gltf.nodes[rootIdx].children || []) : null;

	const rows = [];
	(gltf.nodes || []).forEach((node, index) => {
		if (node.mesh === undefined) return;
		const mesh = meshes[node.mesh];
		const name = node.name || mesh.name || `node_${index}`;

		let lmin = [Infinity, Infinity, Infinity];
		let lmax = [-Infinity, -Infinity, -Infinity];
		for (const prim of mesh.primitives) {
			const acc = accessors[prim.attributes.POSITION];
			if (acc && acc.min && acc.max)
				for (let i = 0; i < 3; i++) {
					lmin[i] = Math.min(lmin[i], acc.min[i]);
					lmax[i] = Math.max(lmax[i], acc.max[i]);
				}
		}

		const wm = worldMatrix(gltf, parentMap, index);
		let wmin = [Infinity, Infinity, Infinity];
		let wmax = [-Infinity, -Infinity, -Infinity];
		for (let cx = 0; cx < 2; cx++)
			for (let cy = 0; cy < 2; cy++)
				for (let cz = 0; cz < 2; cz++) {
					const p = transformPoint(wm, [cx ? lmax[0] : lmin[0], cy ? lmax[1] : lmin[1], cz ? lmax[2] : lmin[2]]);
					for (let i = 0; i < 3; i++) {
						wmin[i] = Math.min(wmin[i], p[i]);
						wmax[i] = Math.max(wmax[i], p[i]);
					}
				}

		const origin = transformPoint(wm, [0, 0, 0]);
		const wsize = [wmax[0] - wmin[0], wmax[1] - wmin[1], wmax[2] - wmin[2]];
		const oToMin = [origin[0] - wmin[0], origin[1] - wmin[1], origin[2] - wmin[2]];
		const pivot = `x:${classify(oToMin[0], wsize[0], "x")} | y:${classify(oToMin[1], wsize[1], "y")} | z:${classify(oToMin[2], wsize[2], "z")}`;
		const cells = `${(wsize[0] / CELL).toFixed(2)}x${(wsize[2] / CELL).toFixed(2)} cells`;
		rows.push({ name, wsize, origin, wmin, wmax, oToMin, pivot, cells, isChild: rootChildren ? rootChildren.has(index) : true });
	});

	rows.sort((a, b) => a.name.localeCompare(b.name));

	console.log("=".repeat(96));
	console.log(`ARENA GLB: ${glbPath}`);
	console.log(`ArenaParts root node: ${rootIdx >= 0 ? "found (idx " + rootIdx + ")" : "NOT FOUND"}   mesh nodes: ${rows.length}`);
	console.log("Axes: +X=east, -Z=north, +Z=south, +Y=up. Origin = the piece's pivot.");
	console.log("=".repeat(96));
	for (const r of rows) {
		console.log(`\n${r.name}${r.isChild ? "" : "   (not a direct child of ArenaParts!)"}`);
		console.log(`  worldSize ${vec(r.wsize)}  (${r.cells})`);
		console.log(`  bbox min ${vec(r.wmin)}  max ${vec(r.wmax)}`);
		console.log(`  origin   ${vec(r.origin)}   origin-from-min ${vec(r.oToMin)}`);
		console.log(`  PIVOT -> ${r.pivot}`);
	}
	console.log("\n" + "=".repeat(96));
	console.log("Done.");
}

main();
