/**
 * ============================================================================
 * gen/chunk.js
 * ----------------------------------------------------------------------------
 * Chunk generation — corner (vertex) height model.
 *
 * Height is sampled at cell CORNERS (grid vertices), not centers. Because
 * adjacent cells share corners, their shared edges always agree → the top
 * surface is continuous by construction (no back-to-back wedges, no seams —
 * and chunk borders match for free since border corners share world coords).
 *
 * Each 3×3 cell reads its 4 corner heights and picks a top tile:
 *   - all equal              → flat top.
 *   - 2 corners high (edge), Δ≤3 → edge ramp toward the high edge.
 *   - 1 corner high, Δ≤3     → corner ramp toward that corner.
 *   - 1 corner low (3 high), Δ≤3 → fill the dip (flat at the high level).
 *   - spread > 3, a diagonal saddle, or 3+ levels → anchor to the LOWEST
 *     corner (flat at lo); taller corners become cliffs (block walls). This is
 *     the "prefer the lowest, never fit the top" rule — it prevents spikes and
 *     gives sheer drop-offs.
 *
 * The tile's named direction is its HIGH side, so high-corner-set maps straight
 * to the tile (high on the east → jyt_ramp_e). Direction↔axis: east = +X,
 * north = −Z (Blender +Y). If N/S ramps face backwards, swap the z sign in the
 * corner sampling below.
 * ============================================================================
 */

import * as THREE from "three";
import { cyrb128 } from "../seed.js";
import { placeStructures } from "./placeStructures.js";

const TILE_BODY = "jyt_flat_33";
const CAP_FLAT = { 1: "jyt_flat_13", 2: "jyt_flat_23" };
const LVL = { 1: "13", 2: "23", 3: "33" };
const SETS = 4;

// Max allowed corner mismatch (meters) when best-fitting a tile that doesn't
// match all four corners exactly. 0 = exact only; 1 = allow ≤1 m seams (fills
// the 3-level diagonal cells that would otherwise be blocky).
const MAX_SEAM = 1;

/**
 * Tile corner signatures, verified against the actual GLB geometry.
 * Corner index: nw=0, ne=1, sw=2, se=3 (east=+X, north=−Z). `high` lists the
 * corners the tile raises to its top level; the rest sit at the base.
 * @type {Array<{high: number[], tile: (lvl: string) => string}>}
 */
const TILE_TEMPLATES = [
	{ high: [0, 1], tile: (l) => `jyt_ramp_n_0_to_${l}` }, // north edge
	{ high: [2, 3], tile: (l) => `jyt_ramp_s_0_to_${l}` }, // south edge
	{ high: [1, 3], tile: (l) => `jyt_ramp_e_0_to_${l}` }, // east edge
	{ high: [0, 2], tile: (l) => `jyt_ramp_w_0_to_${l}` }, // west edge
	{ high: [0], tile: (l) => `jyt_ramp_nw_0_to_${l}` }, // convex corners (1 high)
	{ high: [1], tile: (l) => `jyt_ramp_ne_0_to_${l}` },
	{ high: [2], tile: (l) => `jyt_ramp_sw_0_to_${l}` },
	{ high: [3], tile: (l) => `jyt_ramp_se_0_to_${l}` },
	{ high: [1, 2, 3], tile: (l) => `jyt_ramp_nw_${l}_to_0` }, // concave corners (1 low)
	{ high: [0, 2, 3], tile: (l) => `jyt_ramp_ne_${l}_to_0` },
	{ high: [0, 1, 3], tile: (l) => `jyt_ramp_sw_${l}_to_0` },
	{ high: [0, 1, 2], tile: (l) => `jyt_ramp_se_${l}_to_0` },
];

/**
 * Deterministic tile-set index (0-3) for a block.
 * @param {string} seed @param {number} gx @param {number} gz @param {number} y
 * @returns {number}
 */
function pickSet(seed, gx, gz, y) {
	const [a] = cyrb128(`${seed}_${gx}_${gz}_${y}`);
	return a % SETS;
}

/**
 * @typedef {object} TileChoice
 * @property {"flat"|"ramp"} kind
 * @property {number} base Solid-fill top / ramp base (meters).
 * @property {number} delta Ramp vertical span (0 for flat).
 * @property {string} [dir] Ramp high-side direction (n/s/e/w/ne/nw/se/sw).
 */

/**
 * Pick a cell's top tile from its 4 corner heights.
 * @param {number} nw @param {number} ne @param {number} sw @param {number} se
 * @returns {TileChoice}
 */
export function chooseTile(nw, ne, sw, se) {
	const c = [nw, ne, sw, se];
	const lo = Math.min(nw, ne, sw, se);
	const hi = Math.max(nw, ne, sw, se);
	const span = hi - lo;

	if (span === 0) return { kind: "flat", base: lo, delta: 0 };
	// Spread beyond one wedge: anchor to the lowest corner; the taller corners
	// become cliffs (block walls). Never fit to the top → no spikes.
	if (span > 3) return { kind: "flat", base: lo, delta: 0 };

	// Best-fit the tile whose corner signature is closest to the actual corners,
	// minimising the worst single-corner error first, then total error.
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

	if (best && best.maxErr <= MAX_SEAM) {
		return { kind: "ramp", base: lo, delta: span, tile: best.tile };
	}
	// No acceptable fit (e.g. a diagonal saddle): anchor low.
	return { kind: "flat", base: lo, delta: 0 };
}

/**
 * @typedef {object} GeneratedChunk
 * @property {THREE.Group} group
 * @property {number} maxHeight
 * @property {number} instanceCount
 * @property {number} rampCount
 * @property {() => void} dispose
 */

/**
 * Generate a single chunk.
 * @param {number} cx @param {number} cz
 * @param {{worldConfig: Record<string, *>, heightField: import("./heightField.js").HeightField, registry: Map<string, import("../three/tiles.js").TileEntry>, materials: THREE.Material[]}} ctx
 * @returns {GeneratedChunk}
 */
export function generateChunk(cx, cz, ctx) {
	const { worldConfig, heightField, registry, materials } = ctx;
	const seed = String(worldConfig.seed);
	const cs = Math.round(worldConfig.chunkSize);

	// Corner heights: (cs+1) × (cs+1). corner[i][j] at world ((cx*cs+i)*3, (cz*cs+j)*3).
	/** @type {number[][]} */
	const corner = [];
	for (let i = 0; i <= cs; i++) {
		corner[i] = [];
		for (let j = 0; j <= cs; j++) {
			corner[i][j] = heightField.heightAt((cx * cs + i) * 3, (cz * cs + j) * 3);
		}
	}

	/** @type {Map<string, Array<[number, number, number]>>} */
	const buckets = new Map();
	/** @param {string} tile @param {number} set @param {number} x @param {number} y @param {number} z */
	function push(tile, set, x, y, z) {
		const key = `${tile}|${set}`;
		let arr = buckets.get(key);
		if (!arr) {
			arr = [];
			buckets.set(key, arr);
		}
		arr.push([x, y, z]);
	}

	let maxHeight = 0;
	let instanceCount = 0;
	let rampCount = 0;

	for (let lx = 0; lx < cs; lx++) {
		for (let lz = 0; lz < cs; lz++) {
			// north = −Z → smaller j is north.
			const nw = corner[lx][lz];
			const ne = corner[lx + 1][lz];
			const sw = corner[lx][lz + 1];
			const se = corner[lx + 1][lz + 1];

			const t = chooseTile(nw, ne, sw, se);
			const gx = cx * cs + lx;
			const gz = cz * cs + lz;
			const wx = gx * 3;
			const wz = gz * 3;

			const top = t.base + t.delta;
			if (top > maxHeight) maxHeight = top;

			// Solid body up to the base.
			const fullBlocks = Math.floor(t.base / 3);
			for (let b = 0; b < fullBlocks; b++) {
				const y = b * 3;
				push(TILE_BODY, pickSet(seed, gx, gz, y), wx, y, wz);
				instanceCount++;
			}
			const rem = t.base % 3;
			if (rem > 0) {
				const y = fullBlocks * 3;
				push(CAP_FLAT[rem], pickSet(seed, gx, gz, y), wx, y, wz);
				instanceCount++;
			}
			// Ramp cap on top.
			if (t.kind === "ramp") {
				push(t.tile, pickSet(seed, gx, gz, t.base + 1), wx, t.base, wz);
				instanceCount++;
				rampCount++;
			}
		}
	}

	const group = new THREE.Group();
	const dummy = new THREE.Object3D();
	for (const [key, positions] of buckets) {
		const sep = key.indexOf("|");
		const tileName = key.slice(0, sep);
		const set = Number(key.slice(sep + 1));
		const entry = registry.get(tileName);
		if (!entry) {
			console.warn("[jy] missing tile geometry:", tileName);
			continue;
		}
		const mesh = new THREE.InstancedMesh(entry.geometry, materials[set], positions.length);
		for (let i = 0; i < positions.length; i++) {
			dummy.position.set(positions[i][0], positions[i][1], positions[i][2]);
			dummy.updateMatrix();
			mesh.setMatrixAt(i, dummy.matrix);
		}
		mesh.instanceMatrix.needsUpdate = true;
		// Per-instance bounding sphere so frustum culling works per chunk mesh.
		mesh.computeBoundingSphere();
		group.add(mesh);
	}

	// Structures placed on the surface (cloned templates from the library).
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
					/** @type {THREE.InstancedMesh} */ (o).dispose();
				}
			});
		},
	};
}
