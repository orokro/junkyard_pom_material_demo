/**
 * ============================================================================
 * arena/gen/arena.js
 * ----------------------------------------------------------------------------
 * Top-level arena generation orchestrator.
 *
 * Phase 5 scope: pick the arena shape (seed + aspect ratio → grid), build the
 * outer-ring walls (two stories) and inward pokes, and place grandstand chairs.
 * Later phases add level-2/3 islands, ramps, bridges, tires, and metal barriers.
 *
 * Returns a plain, serializable model (no Three.js / DOM) consumed by
 * three/build.js (instancing) and ui/overlay.js (debug schematic). Pure module.
 * ============================================================================
 */

import { computeDims, inboundsRect } from "./grid.js";
import { buildRings } from "./rings.js";
import { placeChairs } from "./chairs.js";

/**
 * @typedef {object} ArenaModel
 * @property {string} seed
 * @property {Record<string, *>} params
 * @property {import("./grid.js").Dims} dims
 * @property {number} ratio
 * @property {{minX:number,maxX:number,minZ:number,maxZ:number}} bounds  In-bounds world rect.
 * @property {import("./rings.js").Container[]} containers  Ring + poke containers (all stories).
 * @property {import("./chairs.js").Chair[]} chairs
 * @property {string[]} solidCells  Ground-solid cell keys (walls) for later passes/overlay.
 */

/**
 * Generate an arena from a seed + params.
 * @param {string} seed
 * @param {Record<string, *>} params
 * @returns {ArenaModel}
 */
export function generateArena(seed, params) {
	const dims = computeDims(seed, params);
	const rings = buildRings(dims, params, seed);
	const chairs = placeChairs(rings, dims, params, seed);
	const bounds = inboundsRect(dims);

	return {
		seed,
		params,
		dims,
		ratio: dims.ratio,
		bounds,
		containers: rings.containers,
		chairs,
		solidCells: rings.solidCells,
	};
}
