/**
 * ============================================================================
 * arena/gen/islands.js
 * ----------------------------------------------------------------------------
 * Inner-level generation — Phase 6 Step 1: LEVEL-2 islands + their 1→2 ramps.
 *
 * Approach (locked in the plan): "ramps-first, grow islands."
 *   1. Place N 1→2 ramp-runs. A run is 3 cells in a line:
 *        [ lower-lead @L1 (clear) ][ ramp ][ landing @L2 ]
 *      The ramp's UP direction points lead→landing. The lower-lead is reserved
 *      as L1 (never promoted) so a car can line up with the ramp.
 *   2. Grow a hole-free L2 island out from each landing by promoting adjacent
 *      plain-L1 cells to half-platforms, never enclosing an L1 pocket (checked
 *      by a flood-fill), never promoting a reserved ramp-lead.
 *
 * Because each island is seeded at a ramp landing, every island has ≥1 ramp by
 * construction. Islands may merge. Pure module — Node-testable.
 * ============================================================================
 */

import { makeRng } from "../seed.js";
import { key, unkey, isInbounds } from "./grid.js";

/** up-direction name → [dx,dz] (north = -Z). */
export const DIR_VEC = { N: [0, -1], E: [1, 0], S: [0, 1], W: [-1, 0] };

/** @template T @param {T[]} a @param {() => number} rng @returns {T[]} */
function shuffle(a, rng) {
	for (let i = a.length - 1; i > 0; i--) {
		const j = Math.floor(rng() * (i + 1));
		[a[i], a[j]] = [a[j], a[i]];
	}
	return a;
}

/**
 * @typedef {object} Level2Result
 * @property {string[]} level2   Cell keys that are L2 half-platforms.
 * @property {{cx:number,cz:number,dir:"N"|"E"|"S"|"W",from:number,to:number}[]} ramps
 * @property {string[]} reservedL1  Lower-lead cells kept at L1 for ramp access.
 */

/**
 * Generate level-2 islands + 1→2 ramps.
 * @param {import("./grid.js").Dims} dims
 * @param {Record<string, *>} params
 * @param {string} seed
 * @param {Set<string>} pokeCells  In-bounds cells occupied by ring pokes (walls).
 * @returns {Level2Result}
 */
export function generateLevel2(dims, params, seed, pokeCells) {
	const rng = makeRng(seed, "level2");
	const level2 = new Set();
	const rampCells = new Map(); // key -> up dir name
	const reservedL1 = new Set();

	const inB = (x, z) => isInbounds(x, z, dims);
	const isL2 = (x, z) => level2.has(key(x, z));
	const isRamp = (x, z) => rampCells.has(key(x, z));
	/** plain drivable ground: in-bounds, not a poke/wall, not L2, not a ramp. */
	const isL1 = (x, z) => inB(x, z) && !pokeCells.has(key(x, z)) && !isL2(x, z) && !isRamp(x, z);

	/** All current L1 cells reachable (4-conn via L1) from a border L1 cell? (no enclosed pockets) */
	function holeFree() {
		const seen = new Set();
		const stack = [];
		let total = 0;
		for (let x = 0; x < dims.Wc; x++) {
			for (let z = 0; z < dims.Dc; z++) {
				if (!isL1(x, z)) continue;
				total++;
				if ((x === 0 || z === 0 || x === dims.Wc - 1 || z === dims.Dc - 1) && !seen.has(key(x, z))) {
					seen.add(key(x, z));
					stack.push([x, z]);
				}
			}
		}
		while (stack.length) {
			const [x, z] = stack.pop();
			for (const [dx, dz] of Object.values(DIR_VEC)) {
				const nx = x + dx, nz = z + dz;
				if (isL1(nx, nz) && !seen.has(key(nx, nz))) { seen.add(key(nx, nz)); stack.push([nx, nz]); }
			}
		}
		return seen.size === total;
	}

	const area = dims.Wc * dims.Dc;
	const covMin = params.level2CoverageMin ?? 0.08;
	const covMax = params.level2CoverageMax ?? 0.25;
	const targetCells = Math.max(1, Math.round(area * (covMin + rng() * (covMax - covMin))));
	const maxIslands = params.maxIslandsL2 ?? 3;
	const numIslands = 1 + Math.floor(rng() * maxIslands);

	/** Try to place one 1→2 ramp-run; returns its landing cell or null. */
	function placeRamp() {
		const starts = [];
		for (let x = 0; x < dims.Wc; x++) for (let z = 0; z < dims.Dc; z++) starts.push([x, z]);
		shuffle(starts, rng);
		for (const [lx, lz] of starts) {
			for (const [dName, [dx, dz]] of shuffle(Object.entries(DIR_VEC), rng)) {
				const rx = lx + dx, rz = lz + dz;   // ramp cell
				const ax = lx + 2 * dx, az = lz + 2 * dz; // landing
				if (!isL1(lx, lz) || !isL1(rx, rz) || !isL1(ax, az)) continue;
				if (reservedL1.has(key(rx, rz)) || reservedL1.has(key(ax, az))) continue;
				level2.add(key(ax, az));
				rampCells.set(key(rx, rz), dName);
				reservedL1.add(key(lx, lz));
				if (!holeFree()) {
					level2.delete(key(ax, az));
					rampCells.delete(key(rx, rz));
					reservedL1.delete(key(lx, lz));
					continue;
				}
				return [ax, az];
			}
		}
		return null;
	}

	/** Grow an island from a seed landing up to `budget` extra cells. */
	function grow(seedCell, budget) {
		let added = 0;
		const frontier = [seedCell];
		while (added < budget && frontier.length) {
			const fi = Math.floor(rng() * frontier.length);
			const [fx, fz] = frontier[fi];
			let grew = false;
			for (const [dx, dz] of shuffle(Object.values(DIR_VEC), rng)) {
				const nx = fx + dx, nz = fz + dz;
				if (!isL1(nx, nz) || reservedL1.has(key(nx, nz))) continue;
				level2.add(key(nx, nz));
				if (!holeFree()) { level2.delete(key(nx, nz)); continue; }
				frontier.push([nx, nz]);
				added++;
				grew = true;
				break;
			}
			if (!grew) frontier.splice(fi, 1);
		}
		return added;
	}

	const seeds = [];
	for (let i = 0; i < numIslands; i++) {
		const s = placeRamp();
		if (!s) break;
		seeds.push(s);
	}
	if (seeds.length) {
		const perIsland = Math.ceil(Math.max(0, targetCells - seeds.length) / seeds.length);
		for (const s of seeds) grow(s, perIsland);
	}

	const ramps = [...rampCells.entries()].map(([k, dir]) => {
		const [cx, cz] = unkey(k);
		return { cx, cz, dir, from: 0, to: 2 };
	});
	return { level2: [...level2], ramps, reservedL1: [...reservedL1] };
}
