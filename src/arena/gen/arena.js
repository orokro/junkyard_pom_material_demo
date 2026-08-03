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
import { generateLevel2, generateLevel3, makeBarriers } from "./islands.js";
import { generateTires } from "./tires.js";

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
 * @property {string[]} level3  Cell keys raised to level 3 (generated container tops).
 * @property {string[]} bridges  L3 cell keys that are bridges (drivable over AND under).
 * @property {{cx:number,cz:number,dir:string,from:number,to:number}[]} ramps  All ramps (1→2 and 2→3).
 * @property {{cx:number,cz:number,dir:string}[]} barriers  Metal barriers on Y4 surface edges facing OOB.
 * @property {import("./tires.js").Tire[]} tires  Ground-level tire barriers (autotiled).
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

	// Level 3: container-top islands + 2→3 ramps, grown on the ground beneath.
	const l3 = generateLevel3(dims, params, seed, {
		pokeCells,
		level2: l2.level2,
		ramps: l2.ramps,
		reservedL1: l2.reservedL1,
	});
	// L3 dominoes are ground-standing single containers (top forms the Y4 surface);
	// tag them level3 so consumers (overlay/tests) can tell them from ring/poke walls,
	// and flag bridge dominoes so build.js renders the open-underside bridge mesh.
	const l3Containers = l3.containers.map((c) => ({
		...c,
		story: 1,
		ring: false,
		level3: true,
		bridge: c.isBridge === true,
	}));

	// Metal barriers on every Y4 surface edge (L3 islands + inward pokes) facing OOB.
	const barriers = makeBarriers(dims, l3.level3Cells, [...pokeCells]);

	const model = {
		seed,
		params,
		dims,
		ratio: dims.ratio,
		bounds,
		containers: [...rings.containers, ...l3Containers],
		chairs,
		solidCells: rings.solidCells,
		level2: l2.level2,
		level3: l3.level3Cells,
		bridges: l3.bridges,
		ramps: [...l2.ramps, ...l3.ramps23],
		barriers,
	};

	// Tire barriers autotile against the assembled solid mask (walls/L2/L3), so run last.
	model.tires = generateTires(dims, model);
	return model;
}
