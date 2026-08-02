/**
 * ============================================================================
 * arena/gen/chairs.js
 * ----------------------------------------------------------------------------
 * Chair (grandstand) placement (Phase 5).
 *
 * Chairs spawn only on OUTER-RING container tops that are open to the sky, on
 * BOTH stories (first-story tops not covered by a second-story container at Y=4,
 * and second-story tops at Y=8). A random few per eligible top, random chair
 * type, facing the arena center with a ±15° jitter — scrappy red-neck stands
 * looking in at the action.
 *
 * Pure module — Node-testable. Positions are world-space; chairs are south-facing
 * (+Z) at rotationY=0, so rotationY = atan2(dir.x, dir.z) aims +Z at the target.
 * ============================================================================
 */

import { makeRng } from "../seed.js";
import { CELL, cellCenter } from "./grid.js";

const CHAIR_TYPES = ["Bench", "FoldingChair", "LawnChair", "PlasticChair"];
const JITTER = (15 * Math.PI) / 180; // ±15 degrees
const INSET = 0.7; // keep chairs off the very edge of the container top

/** @param {() => number} rng @param {number} lo @param {number} hi @returns {number} */
const randInt = (rng, lo, hi) => lo + Math.floor(rng() * (hi - lo + 1));
/** @param {() => number} rng @param {number} lo @param {number} hi @returns {number} */
const randRange = (rng, lo, hi) => lo + rng() * (hi - lo);

/**
 * @typedef {object} Chair
 * @property {string} chairType  Bench/FoldingChair/LawnChair/PlasticChair.
 * @property {[number, number, number]} pos  World position (pivot = bottom-center).
 * @property {number} rotY  Y rotation (radians).
 */

/**
 * Place chairs on eligible ring-container tops.
 * @param {ReturnType<import("./rings.js").buildRings>} rings
 * @param {import("./grid.js").Dims} dims
 * @param {Record<string, *>} params
 * @param {string} seed
 * @returns {Chair[]}
 */
export function placeChairs(rings, dims, params, seed) {
	const rng = makeRng(seed, "chairs");
	const chance = params.chairChance ?? 0.55;
	const [cxWorld, czWorld] = [(dims.Wc * CELL) / 2, (dims.Dc * CELL) / 2];

	// Eligible sky-open tops: ground frame not covered by an upper, + all uppers.
	const covered = new Set(rings.upper.map((u) => u.ground));
	/** @type {{cells:[[number,number],[number,number]], y:number}[]} */
	const tops = [];
	rings.groundFrame.forEach((g, i) => {
		if (!covered.has(i)) tops.push({ cells: g.cells, y: 4 });
	});
	rings.upper.forEach((u) => tops.push({ cells: u.cells, y: 8 }));

	/** @type {Chair[]} */
	const chairs = [];
	for (const top of tops) {
		if (rng() >= chance) continue;
		// World footprint of the two-cell top.
		const xs = top.cells.map((c) => c[0]);
		const zs = top.cells.map((c) => c[1]);
		const minX = Math.min(...xs) * CELL;
		const maxX = (Math.max(...xs) + 1) * CELL;
		const minZ = Math.min(...zs) * CELL;
		const maxZ = (Math.max(...zs) + 1) * CELL;

		const count = randInt(rng, 1, 2);
		for (let i = 0; i < count; i++) {
			const x = randRange(rng, minX + INSET, maxX - INSET);
			const z = randRange(rng, minZ + INSET, maxZ - INSET);
			const dirX = cxWorld - x;
			const dirZ = czWorld - z;
			const rotY = Math.atan2(dirX, dirZ) + (rng() * 2 - 1) * JITTER;
			chairs.push({ chairType: CHAIR_TYPES[Math.floor(rng() * CHAIR_TYPES.length)], pos: [x, top.y, z], rotY });
		}
	}
	return chairs;
}
