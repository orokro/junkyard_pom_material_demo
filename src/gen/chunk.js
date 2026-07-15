/**
 * ============================================================================
 * gen/chunk.js
 * ----------------------------------------------------------------------------
 * Chunk generation with ramp caps (Phase 3.2b).
 *
 * Each column's integer height H comes from the global height field. The solid
 * body is `flat_33` (3 m) blocks plus a `flat_13`/`flat_23` remainder cap; the
 * TOP is then either left flat or replaced by a ramp that slopes down toward
 * lower neighbours.
 *
 * Ramp selection (steep-inclusive, deltas 1/2/3):
 *   - Compare the 8 neighbours' heights. If two adjacent sides AND the diagonal
 *     between them are lower → corner ramp toward that diagonal. Else, if any
 *     orthogonal side is lower → edge ramp toward the steepest one. Else flat.
 *   - A ramp descending toward direction D uses the tile named for the OPPOSITE
 *     direction, because a tile's named direction is its HIGH side
 *     (jyt_ramp_e rises toward +X/east).
 *   - delta = clamp(neighbour drop, 1, min(3, H)). The wedge is placed at base
 *     Y = H − delta so its high edge is at H and its low edge meets the
 *     neighbour top (when the drop ≤ 3).
 *
 * Direction↔axis: east = +X, and (Blender +Y "north" → glTF −Z) so north = −Z,
 * south = +Z. If ramps end up facing the wrong way, flipping N/S (or E/W) here
 * is the one-line fix.
 *
 * Per-block texture variety: each placement hashes to a tile set 0-3, batched
 * into one InstancedMesh per (tile, set). Full columns render to Y=0 for now;
 * the visible-shell skip lands with streaming (3.3).
 * ============================================================================
 */

import * as THREE from "three";
import { cyrb128 } from "../seed.js";

const TILE_BODY = "jyt_flat_33";
const CAP_FLAT = { 1: "jyt_flat_13", 2: "jyt_flat_23" };
const OPP = { n: "s", s: "n", e: "w", w: "e", ne: "sw", sw: "ne", nw: "se", se: "nw" };
const LVL = { 1: "13", 2: "23", 3: "33" };
const SETS = 4;

/**
 * Deterministic tile-set index (0-3) for a block.
 * @param {string} seed @param {number} colX @param {number} colZ @param {number} y
 * @returns {number}
 */
function pickSet(seed, colX, colZ, y) {
	const [a] = cyrb128(`${seed}_${colX}_${colZ}_${y}`);
	return a % SETS;
}

/**
 * @typedef {object} CapChoice
 * @property {"flat"|"ramp"} kind
 * @property {number} delta Ramp vertical span in meters (0 for flat).
 * @property {string} [tile] Ramp tile name.
 */

/**
 * Choose a top cap for a column from its neighbour heights.
 * @param {number} H Column height (meters).
 * @param {Record<string, number>} nb Neighbour heights keyed n/s/e/w/ne/nw/se/sw.
 * @returns {CapChoice}
 */
export function chooseCap(H, nb) {
	const maxDelta = Math.min(3, H);
	if (maxDelta < 1) return { kind: "flat", delta: 0 };

	/** @type {Record<string, number>} downhill amount per direction (>0 = neighbour lower). */
	const d = {
		e: H - nb.e, w: H - nb.w, n: H - nb.n, s: H - nb.s,
		ne: H - nb.ne, nw: H - nb.nw, se: H - nb.se, sw: H - nb.sw,
	};

	// Corner ramps: both adjacent orthogonals and the diagonal must be lower.
	const corners = [
		["n", "e", "ne"], ["n", "w", "nw"], ["s", "e", "se"], ["s", "w", "sw"],
	];
	/** @type {(CapChoice & {score: number})|null} */
	let bestCorner = null;
	for (const [a, b, diag] of corners) {
		if (d[a] >= 1 && d[b] >= 1 && d[diag] >= 1) {
			const delta = Math.min(maxDelta, d[diag]);
			if (!bestCorner || d[diag] > bestCorner.score) {
				bestCorner = { kind: "ramp", tile: `jyt_ramp_${OPP[diag]}_0_to_${LVL[delta]}`, delta, score: d[diag] };
			}
		}
	}
	if (bestCorner) return bestCorner;

	// Edge ramp toward the steepest single downhill side.
	const edges = [["e", d.e], ["w", d.w], ["n", d.n], ["s", d.s]];
	/** @type {{dir: string, drop: number}|null} */
	let bestEdge = null;
	for (const [dir, drop] of edges) {
		if (drop >= 1 && (!bestEdge || drop > bestEdge.drop)) {
			bestEdge = { dir: /** @type {string} */ (dir), drop: /** @type {number} */ (drop) };
		}
	}
	if (bestEdge) {
		const delta = Math.min(maxDelta, bestEdge.drop);
		return { kind: "ramp", tile: `jyt_ramp_${OPP[bestEdge.dir]}_0_to_${LVL[delta]}`, delta };
	}
	return { kind: "flat", delta: 0 };
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
	const H = (x, z) => heightField.columnHeight(x, z);

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
			const colX = cx * cs + lx;
			const colZ = cz * cs + lz;
			const h = H(colX, colZ);
			if (h <= 0) continue;
			if (h > maxHeight) maxHeight = h;

			const nb = {
				e: H(colX + 1, colZ), w: H(colX - 1, colZ),
				n: H(colX, colZ - 1), s: H(colX, colZ + 1),
				ne: H(colX + 1, colZ - 1), nw: H(colX - 1, colZ - 1),
				se: H(colX + 1, colZ + 1), sw: H(colX - 1, colZ + 1),
			};
			const cap = chooseCap(h, nb);
			const solidTop = cap.kind === "ramp" ? h - cap.delta : h;

			const wx = colX * 3;
			const wz = colZ * 3;
			const fullBlocks = Math.floor(solidTop / 3);
			for (let b = 0; b < fullBlocks; b++) {
				const y = b * 3;
				push(TILE_BODY, pickSet(seed, colX, colZ, y), wx, y, wz);
				instanceCount++;
			}
			const rem = solidTop % 3;
			if (rem > 0) {
				const y = fullBlocks * 3;
				push(CAP_FLAT[rem], pickSet(seed, colX, colZ, y), wx, y, wz);
				instanceCount++;
			}
			if (cap.kind === "ramp") {
				push(cap.tile, pickSet(seed, colX, colZ, h), wx, solidTop, wz);
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
		mesh.frustumCulled = false;
		for (let i = 0; i < positions.length; i++) {
			dummy.position.set(positions[i][0], positions[i][1], positions[i][2]);
			dummy.updateMatrix();
			mesh.setMatrixAt(i, dummy.matrix);
		}
		mesh.instanceMatrix.needsUpdate = true;
		group.add(mesh);
	}

	return {
		group,
		maxHeight,
		instanceCount,
		rampCount,
		dispose() {
			group.traverse((o) => {
				if (/** @type {THREE.InstancedMesh} */ (o).isInstancedMesh) {
					/** @type {THREE.InstancedMesh} */ (o).dispose();
				}
			});
		},
	};
}
