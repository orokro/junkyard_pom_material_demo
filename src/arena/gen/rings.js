/**
 * ============================================================================
 * arena/gen/rings.js
 * ----------------------------------------------------------------------------
 * Outer-ring wall generation (Phase 5).
 *
 * Fills the 2-cell-wide band around the in-bounds rectangle with shipping
 * containers (domino tiling → no ground gaps, varied H/V orientation, random
 * colors). Adds a partial SECOND STORY (a random subset of the ground footprints
 * at Y=4, gaps allowed). Also pokes a few containers inward past the boundary so
 * the playable outline is not a perfect rectangle.
 *
 * Pure module — Node-testable. Container transforms are derived later in
 * three/build.js from each domino's two cells.
 * ============================================================================
 */

import { makeRng } from "../seed.js";
import { ringBandCells, isInbounds, key } from "./grid.js";
import { tileDominoes } from "./dominoes.js";

const COLORS = ["Blue", "Red", "White", "Green"];

/** @param {() => number} rng @param {number} lo @param {number} hi @returns {number} inclusive int */
const randInt = (rng, lo, hi) => lo + Math.floor(rng() * (hi - lo + 1));
/** @param {() => number} rng @template T @param {T[]} a @returns {T} */
const pick = (rng, a) => a[Math.floor(rng() * a.length)];

/**
 * @typedef {object} Container
 * @property {[[number,number],[number,number]]} cells  The two covered cells.
 * @property {"H"|"V"} orient
 * @property {string} color  One of Blue/Red/White/Green.
 * @property {1|2} story  1 = ground (Y=0 base), 2 = second story (Y=4 base).
 * @property {boolean} ring  True = part of the outer ring; false = inward poke.
 * @property {number} [ground]  For story-2: index of the ground container it sits on.
 */

/**
 * Build the outer-ring walls.
 * @param {import("./grid.js").Dims} dims
 * @param {Record<string, *>} params
 * @param {string} seed
 * @returns {{ containers: Container[], groundFrame: Container[], upper: Container[], pokes: Container[], solidCells: string[] }}
 */
export function buildRings(dims, params, seed) {
	const rng = makeRng(seed, "rings");
	const upperChance = params.secondStoryChance ?? 0.5;
	const maxPokes = params.maxInwardPokes ?? 4;

	// --- Ground frame (domino-tiled, gap-free) ---
	const frame = ringBandCells(dims, 2);
	const { dominoes } = tileDominoes(frame, rng);
	/** @type {Container[]} */
	const groundFrame = dominoes.map((d) => ({
		cells: [d.a, d.b],
		orient: d.orient,
		color: pick(rng, COLORS),
		story: 1,
		ring: true,
	}));

	// --- Second story (random subset of ground footprints, at Y=4) ---
	/** @type {Container[]} */
	const upper = [];
	groundFrame.forEach((g, i) => {
		if (rng() < upperChance) {
			upper.push({ cells: g.cells, orient: g.orient, color: pick(rng, COLORS), story: 2, ring: true, ground: i });
		}
	});

	// --- Inward pokes (break the rectangle) ---
	// Pokes are containers poking into the arena. We must NOT create a 1-wide
	// dead-end (a ground cell walled on 3 sides), because no tire piece can close
	// one — so each candidate poke is validated and rejected if it would.
	/** @type {Container[]} */
	const pokes = [];
	const used = new Set();
	/** in-bounds cells occupied by an accepted poke (frame is out-of-bounds → wall). */
	const pokeCells = new Set();
	const DIRS4 = [ [1, 0], [-1, 0], [0, 1], [0, -1] ];
	/** A cell is a "wall" for dead-end purposes if it's outside the arena (ring/OOB) or has a poke. */
	const isWall = (x, z) => !isInbounds(x, z, dims) || pokeCells.has(key(x, z));
	/** R1 — do the in-bounds ground cells (minus pokes) still form ONE component? */
	const groundOneComponent = () => {
		let total = 0, start = null;
		for (let cx = 0; cx < dims.Wc; cx++) for (let cz = 0; cz < dims.Dc; cz++) {
			if (!pokeCells.has(key(cx, cz))) { total++; if (!start) start = [cx, cz]; }
		}
		if (!start) return true;
		const seen = new Set([key(start[0], start[1])]);
		const st = [start];
		while (st.length) {
			const [cx, cz] = st.pop();
			for (const [dx, dz] of DIRS4) {
				const nx = cx + dx, nz = cz + dz;
				if (isInbounds(nx, nz, dims) && !pokeCells.has(key(nx, nz)) && !seen.has(key(nx, nz))) { seen.add(key(nx, nz)); st.push([nx, nz]); }
			}
		}
		return seen.size === total;
	};
	/** Would these (already-added) poke cells leave any open neighbor walled on ≥3 sides? */
	const createsDeadEnd = (cells) => {
		for (const [cx0, cz0] of cells) {
			for (const [dx, dz] of DIRS4) {
				const nx = cx0 + dx, nz = cz0 + dz;
				if (isWall(nx, nz)) continue; // only open in-bounds cells can be dead-ends
				let w = 0;
				for (const [ex, ez] of DIRS4) if (isWall(nx + ex, nz + ez)) w++;
				if (w >= 3) return true;
			}
		}
		return false;
	};

	const perim = [];
	for (let cx = 0; cx < dims.Wc; cx++) {
		for (let cz = 0; cz < dims.Dc; cz++) {
			if (cx === 0 || cz === 0 || cx === dims.Wc - 1 || cz === dims.Dc - 1) perim.push([cx, cz]);
		}
	}
	const pokeCount = randInt(rng, 0, maxPokes);
	let attempts = 0;
	while (pokes.length < pokeCount && attempts < pokeCount * 8 + 8) {
		attempts++;
		const a = perim[Math.floor(rng() * perim.length)];
		if (!a || used.has(key(a[0], a[1]))) continue;
		const dir = pick(rng, DIRS4);
		const b = [a[0] + dir[0], a[1] + dir[1]];
		if (!isInbounds(b[0], b[1], dims) || used.has(key(b[0], b[1]))) continue;
		// Tentatively occupy, then reject if it forms a dead-end.
		pokeCells.add(key(a[0], a[1]));
		pokeCells.add(key(b[0], b[1]));
		if (createsDeadEnd([a, b]) || !groundOneComponent()) {
			pokeCells.delete(key(a[0], a[1]));
			pokeCells.delete(key(b[0], b[1]));
			continue;
		}
		used.add(key(a[0], a[1]));
		used.add(key(b[0], b[1]));
		pokes.push({
			cells: [a, b],
			orient: a[1] === b[1] ? "H" : "V",
			color: pick(rng, COLORS),
			story: 1,
			ring: false,
		});
	}

	// Solid ground cells (walls) = ring frame + pokes (upper does not add ground solids).
	const solidCells = new Set();
	for (const c of [...groundFrame, ...pokes]) {
		for (const [x, z] of c.cells) solidCells.add(key(x, z));
	}

	// --- Metal rail barriers (inner-ring railing) ---
	// The ONLY place rails are generated. A guard rail sits on TOP (Y=4) of every
	// SINGLE-STORY ring container, along EACH edge that meets the in-bounds playable area.
	// This lines the inner top of the one-container-high wall (the "stadium railing" from
	// the field) so a car can't cross from the field / a platform / a poke into the ring
	// (chairs + tents) or beyond. Two-story ring containers are tall walls already — skipped.
	// NOTE: inward pokes ARE drivable play area (they just hug the wall to break the square),
	// so R1 edges facing a poke ARE railed too — you may drive a poke, but not past it into
	// the ring. Rails are never placed on anything but these single-story ring tops.
	const upperGround = new Set();
	for (const u of upper) if (u.ground != null) upperGround.add(u.ground);
	const DIRB = { N: [0, -1], E: [1, 0], S: [0, 1], W: [-1, 0] };
	/** @type {{cx:number,cz:number,dir:"N"|"E"|"S"|"W"}[]} */
	const railBarriers = [];
	groundFrame.forEach((c, i) => {
		if (upperGround.has(i)) return; // two-story: the upper container is the wall
		for (const [x, z] of c.cells) {
			for (const [d, [dx, dz]] of Object.entries(DIRB)) {
				if (isInbounds(x + dx, z + dz, dims)) railBarriers.push({ cx: x, cz: z, dir: d });
			}
		}
	});

	// --- Third (occlusion) ring ---
	// A back row of containers one cell OUTSIDE the 2-wide wall, starting at STORY 2
	// (no ground floor — it's occluded), placed only where the wall in front of it is
	// single-story (a sky gap). Randomly bumped to a 3rd story for verticality. This
	// blocks sightlines into the empty distance so the arena feels fully enclosed.
	const band2set = new Set(ringBandCells(dims, 2).map(([x, z]) => key(x, z)));
	const thirdBand = ringBandCells(dims, 3).filter(([x, z]) => !band2set.has(key(x, z)));
	const story2cells = new Set();
	for (const u of upper) for (const [x, z] of u.cells) story2cells.add(key(x, z));
	const occStory3 = params.occluderStory3Chance ?? 0.4;
	/** @type {Container[]} */
	const occluders = [];
	const { dominoes: band3dominoes } = tileDominoes(thirdBand, rng);
	for (const d of band3dominoes) {
		const cells = [d.a, d.b];
		// Needed if the wall cell directly in front (one step toward the arena) has no
		// second story — i.e. sky shows over the single-story section there.
		let need = false;
		for (const [cx, cz] of cells) {
			const inX = cx < 0 ? 1 : cx >= dims.Wc ? -1 : 0;
			const inZ = cz < 0 ? 1 : cz >= dims.Dc ? -1 : 0;
			const fronts = [];
			if (inX) fronts.push(key(cx + inX, cz));
			if (inZ) fronts.push(key(cx, cz + inZ));
			if (fronts.some((fk) => band2set.has(fk) && !story2cells.has(fk))) need = true;
		}
		if (!need) continue;
		occluders.push({ cells, orient: d.orient, color: pick(rng, COLORS), story: 2, ring: true, occluder: true });
		if (rng() < occStory3) occluders.push({ cells, orient: d.orient, color: pick(rng, COLORS), story: 3, ring: true, occluder: true });
	}

	return {
		containers: [...groundFrame, ...upper, ...pokes, ...occluders],
		groundFrame,
		upper,
		pokes,
		occluders,
		solidCells: [...solidCells],
		railBarriers,
	};
}
