/**
 * ============================================================================
 * gen/chunk.js
 * ----------------------------------------------------------------------------
 * Chunk generation — corner (vertex) height model + per-block texture variety
 * + per-instance biome scalars (aBiome) for shader tinting, + surface
 * structures cloned from the library.
 *
 * Each terrain InstancedMesh shares the registry's vertex buffers (uploaded
 * once) and adds a per-chunk `aBiome` InstancedBufferAttribute (rust,tire,
 * pits,paths sampled once per cell), read by the POM material to tint albedo.
 * On dispose the shared buffers are detached so only aBiome is freed.
 * ============================================================================
 */

import * as THREE from "three";
import { cyrb128 } from "../seed.js";
import { placeStructures } from "./placeStructures.js";

const TILE_BODY = "jyt_flat_33";
const CAP_FLAT = { 1: "jyt_flat_13", 2: "jyt_flat_23" };
const LVL = { 1: "13", 2: "23", 3: "33" };
const SETS = 4;
const MAX_SEAM = 1;

const TILE_TEMPLATES = [
	{ high: [0, 1], tile: (l) => `jyt_ramp_n_0_to_${l}` },
	{ high: [2, 3], tile: (l) => `jyt_ramp_s_0_to_${l}` },
	{ high: [1, 3], tile: (l) => `jyt_ramp_e_0_to_${l}` },
	{ high: [0, 2], tile: (l) => `jyt_ramp_w_0_to_${l}` },
	{ high: [0], tile: (l) => `jyt_ramp_nw_0_to_${l}` },
	{ high: [1], tile: (l) => `jyt_ramp_ne_0_to_${l}` },
	{ high: [2], tile: (l) => `jyt_ramp_sw_0_to_${l}` },
	{ high: [3], tile: (l) => `jyt_ramp_se_0_to_${l}` },
	{ high: [1, 2, 3], tile: (l) => `jyt_ramp_nw_${l}_to_0` },
	{ high: [0, 2, 3], tile: (l) => `jyt_ramp_ne_${l}_to_0` },
	{ high: [0, 1, 3], tile: (l) => `jyt_ramp_sw_${l}_to_0` },
	{ high: [0, 1, 2], tile: (l) => `jyt_ramp_se_${l}_to_0` },
];

/** @returns {number} deterministic tile-set index 0-3. */
function pickSet(seed, gx, gz, y) {
	const [a] = cyrb128(`${seed}_${gx}_${gz}_${y}`);
	return a % SETS;
}

/** Minimum biome scalar for a cell to swap to that biome's texture family. */
const FAMILY_SWAP = 0.35;

/**
 * Pick a cell's texture family from its biome scalars. Whichever of rust/tire
 * is strongest (and past the swap threshold) wins; otherwise the default sets.
 * @param {import("./heightField.js").Biomes} b
 * @returns {"def"|"rust"|"tire"}
 */
function pickFamily(b) {
	if (b.rust >= b.tire && b.rust > FAMILY_SWAP) return "rust";
	if (b.tire > FAMILY_SWAP) return "tire";
	return "def";
}

/**
 * Pick a cell's top tile from its 4 corner heights.
 * @param {number} nw @param {number} ne @param {number} sw @param {number} se
 * @returns {{kind: "flat"|"ramp", base: number, delta: number, tile?: string}}
 */
export function chooseTile(nw, ne, sw, se) {
	const c = [nw, ne, sw, se];
	const lo = Math.min(nw, ne, sw, se);
	const hi = Math.max(nw, ne, sw, se);
	const span = hi - lo;
	if (span === 0) return { kind: "flat", base: lo, delta: 0 };
	if (span > 3) return { kind: "flat", base: lo, delta: 0 };
	let best = null;
	for (const t of TILE_TEMPLATES) {
		let maxErr = 0;
		let sumErr = 0;
		for (let i = 0; i < 4; i++) {
			const target = lo + (t.high.includes(i) ? span : 0);
			const e = Math.abs(c[i] - target);
			if (e > maxErr) maxErr = e;
			sumErr += e;
		}
		if (!best || maxErr < best.maxErr || (maxErr === best.maxErr && sumErr < best.sumErr)) {
			best = { tile: t.tile(LVL[span]), maxErr, sumErr };
		}
	}
	if (best && best.maxErr <= MAX_SEAM) return { kind: "ramp", base: lo, delta: span, tile: best.tile };
	return { kind: "flat", base: lo, delta: 0 };
}

/**
 * Generate a chunk (terrain + structures).
 * @param {number} cx @param {number} cz
 * @param {{worldConfig: Record<string, *>, heightField: *, registry: Map<string, *>, materials: {def: THREE.Material[], rust: THREE.Material, tire: THREE.Material}, structures?: *}} ctx
 * @returns {{group: THREE.Group, maxHeight: number, instanceCount: number, rampCount: number, structureCount: number, dispose: () => void}}
 */
export function generateChunk(cx, cz, ctx) {
	const { worldConfig, heightField, registry, materials } = ctx;
	const seed = String(worldConfig.seed);
	const cs = Math.round(worldConfig.chunkSize);

	// Corner heights.
	const corner = [];
	for (let i = 0; i <= cs; i++) {
		corner[i] = [];
		for (let j = 0; j <= cs; j++) corner[i][j] = heightField.heightAt((cx * cs + i) * 3, (cz * cs + j) * 3);
	}

	/** @type {Map<string, Array<[number, number, number, number, number, number, number]>>} */
	const buckets = new Map();
	/** @param {string} tile @param {"def"|"rust"|"tire"} family @param {number} set @param {number} x @param {number} y @param {number} z @param {import("./heightField.js").Biomes} b */
	function push(tile, family, set, x, y, z, b) {
		const key = `${tile}|${family}|${set}`;
		let arr = buckets.get(key);
		if (!arr) {
			arr = [];
			buckets.set(key, arr);
		}
		arr.push([x, y, z, b.rust, b.tire, b.pits, b.paths]);
	}

	let maxHeight = 0;
	let instanceCount = 0;
	let rampCount = 0;

	for (let lx = 0; lx < cs; lx++) {
		for (let lz = 0; lz < cs; lz++) {
			const nw = corner[lx][lz];
			const ne = corner[lx + 1][lz];
			const sw = corner[lx][lz + 1];
			const se = corner[lx + 1][lz + 1];
			const t = chooseTile(nw, ne, sw, se);
			const gx = cx * cs + lx;
			const gz = cz * cs + lz;
			const wx = gx * 3;
			const wz = gz * 3;
			const b = heightField.biomesAt(wx + 1.5, wz + 1.5); // once per cell
			const family = pickFamily(b); // rust/tire piles get their own POM set
			const setOf = (y) => (family === "def" ? pickSet(seed, gx, gz, y) : 0);
			const top = t.base + t.delta;
			if (top > maxHeight) maxHeight = top;

			const fullBlocks = Math.floor(t.base / 3);
			for (let bl = 0; bl < fullBlocks; bl++) {
				const y = bl * 3;
				push(TILE_BODY, family, setOf(y), wx, y, wz, b);
				instanceCount++;
			}
			const rem = t.base % 3;
			if (rem > 0) {
				const y = fullBlocks * 3;
				push(CAP_FLAT[rem], family, setOf(y), wx, y, wz, b);
				instanceCount++;
			}
			if (t.kind === "ramp") {
				push(t.tile, family, setOf(t.base + 1), wx, t.base, wz, b);
				instanceCount++;
				rampCount++;
			}
		}
	}

	const group = new THREE.Group();
	const dummy = new THREE.Object3D();
	for (const [key, positions] of buckets) {
		const [tileName, family, setStr] = key.split("|");
		const set = Number(setStr);
		const entry = registry.get(tileName);
		if (!entry) {
			console.warn("[jy] missing tile geometry:", tileName);
			continue;
		}
		const material = family === "def" ? materials.def[set] : materials[family];
		// Share the registry's vertex buffers (uploaded to the GPU once) and add
		// only a small per-chunk aBiome instanced attribute. Cloning the geometry
		// re-uploaded all vertex data every chunk, which stuttered on fast flight.
		const src = entry.geometry;
		const geo = new THREE.BufferGeometry();
		geo.setAttribute("position", src.attributes.position);
		if (src.attributes.normal) geo.setAttribute("normal", src.attributes.normal);
		if (src.attributes.uv) geo.setAttribute("uv", src.attributes.uv);
		if (src.index) geo.setIndex(src.index);
		const biomeAttr = new THREE.InstancedBufferAttribute(new Float32Array(positions.length * 4), 4);
		const mesh = new THREE.InstancedMesh(geo, material, positions.length);
		for (let i = 0; i < positions.length; i++) {
			const p = positions[i];
			dummy.position.set(p[0], p[1], p[2]);
			dummy.updateMatrix();
			mesh.setMatrixAt(i, dummy.matrix);
			biomeAttr.setXYZW(i, p[3], p[4], p[5], p[6]);
		}
		geo.setAttribute("aBiome", biomeAttr);
		mesh.instanceMatrix.needsUpdate = true;
		mesh.computeBoundingSphere();
		group.add(mesh);
	}

	// Structures on the surface.
	let structureCount = 0;
	if (ctx.structures) {
		for (const pl of placeStructures(cx, cz, ctx)) {
			const obj = pl.item.template.clone(true);
			obj.position.set(pl.x, pl.y, pl.z);
			obj.rotation.y = pl.rotY;
			group.add(obj);
			structureCount++;
		}
	}

	return {
		group,
		maxHeight,
		instanceCount,
		rampCount,
		structureCount,
		dispose() {
			group.traverse((o) => {
				if (/** @type {THREE.InstancedMesh} */ (o).isInstancedMesh) {
					const g = /** @type {THREE.InstancedMesh} */ (o).geometry;
					// Detach the shared registry buffers first so dispose() frees ONLY
					// this chunk's aBiome buffer (not the geometry other chunks share).
					g.deleteAttribute("position");
					g.deleteAttribute("normal");
					g.deleteAttribute("uv");
					g.setIndex(null);
					g.dispose();
					/** @type {THREE.InstancedMesh} */ (o).dispose();
				}
			});
		},
	};
}
