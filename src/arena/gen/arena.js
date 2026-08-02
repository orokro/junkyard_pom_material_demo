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

import { computeDims, inboundsRect, key } from "./grid.js";
import { buildRings } from "./rings.js";
import { placeChairs } from "./chairs.js";
import { generateLevel2 } from "./islands.js";

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
 * @property {string[]} level2  Cell keys raised to level 2 (half-platforms).
 * @property {{cx:number,cz:number,dir:string,from:number,to:number}[]} ramps
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

	// In-bounds cells blocked for island building = poke (inward wall) cells.
	const pokeCells = new Set();
	for (const p of rings.pokes) for (const [x, z] of p.cells) pokeCells.add(key(x, z));
	const l2 = generateLevel2(dims, params, seed, pokeCells);

	return {
		seed,
		params,
		dims,
		ratio: dims.ratio,
		bounds,
		containers: rings.containers,
		chairs,
		solidCells: rings.solidCells,
		level2: l2.level2,
		ramps: l2.ramps,
	};
}
