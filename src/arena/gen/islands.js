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
	/**
	 * Is the edge from ground cell (gx,gz) toward (dx,dz) blocked for a car? Walls,
	 * pokes and L2 platforms block. A RAMP is DIRECTIONAL — a car can only drive
	 * onto it from its low end (heading in the ramp's up-direction), so a ramp walls
	 * off its two sides and its high end. This is what stops paths dead-ending into
	 * a ramp's side (and ramps running into each other's sides).
	 */
	const edgeBlocked = (gx, gz, dx, dz) => {
		const nx = gx + dx, nz = gz + dz;
		if (!inB(nx, nz) || pokeCells.has(key(nx, nz)) || isL2(nx, nz)) return true;
		const rd = rampCells.get(key(nx, nz));
		if (rd) { const [ux, uz] = DIR_VEC[rd]; return !(dx === ux && dz === uz); }
		return false;
	};
	/** Would the applied change leave an open ground cell drivable-walled on ≥3 sides? */
	const createsDeadEnd = (cells) => {
		for (const [cx0, cz0] of cells) {
			for (const [dx, dz] of Object.values(DIR_VEC)) {
				const nx = cx0 + dx, nz = cz0 + dz;
				if (!isL1(nx, nz)) continue; // only open ground cells can be dead-ends
				let b = 0;
				for (const [ex, ez] of Object.values(DIR_VEC)) if (edgeBlocked(nx, nz, ex, ez)) b++;
				if (b >= 3) return true;
			}
		}
		return false;
	};

	/**
	 * Are all drivable cells one connected component (no traps)? Drivable = L1
	 * ground + L2 platforms; L1↔L1 and L2↔L2 by adjacency, and each ramp links its
	 * lower-lead (L1) to its landing (L2). You can only fall DOWN (one-way), so any
	 * separate component is a trap — even one touching the arena border (which is a
	 * wall, not an exit). This replaces the earlier border-based hole check.
	 */
	function connected() {
		const rampEdge = new Map();
		const link = (a, b) => { (rampEdge.get(a) || rampEdge.set(a, []).get(a)).push(b); };
		for (const [rk, d] of rampCells) {
			const [rx, rz] = unkey(rk);
			const [dx, dz] = DIR_VEC[d];
			const lead = key(rx - dx, rz - dz);
			const land = key(rx + dx, rz + dz);
			link(lead, land);
			link(land, lead);
		}
		let total = 0;
		let start = null;
		for (let x = 0; x < dims.Wc; x++) for (let z = 0; z < dims.Dc; z++) {
			if (isL1(x, z) || isL2(x, z)) { total++; if (!start) start = [x, z]; }
		}
		if (!start) return true;
		const seen = new Set([key(start[0], start[1])]);
		const st = [start];
		while (st.length) {
			const [x, z] = st.pop();
			const cur = key(x, z);
			const curL1 = isL1(x, z);
			for (const [dx, dz] of Object.values(DIR_VEC)) {
				const nx = x + dx, nz = z + dz, nk = key(nx, nz);
				if (seen.has(nk)) continue;
				if (curL1 ? isL1(nx, nz) : isL2(nx, nz)) { seen.add(nk); st.push([nx, nz]); }
			}
			const re = rampEdge.get(cur);
			if (re) for (const nk of re) { if (!seen.has(nk)) { const [nx, nz] = unkey(nk); seen.add(nk); st.push([nx, nz]); } }
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
				// Keep ramps apart: no ramp cell orthogonally adjacent to another ramp,
				// so a ramp never runs into the side of another ramp.
				if (Object.values(DIR_VEC).some(([ex, ez]) => isRamp(rx + ex, rz + ez))) continue;
				level2.add(key(ax, az));
				rampCells.set(key(rx, rz), dName);
				reservedL1.add(key(lx, lz));
				if (!connected() || createsDeadEnd([[ax, az], [rx, rz], [lx, lz]])) {
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
				if (!connected() || createsDeadEnd([[nx, nz]])) { level2.delete(key(nx, nz)); continue; }
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

/**
 * @typedef {object} Level3Result
 * @property {string[]} level3Cells  Cell keys covered by generated L3 containers.
 * @property {{cells:[[number,number],[number,number]],orient:"H"|"V",color:string,isBridge?:boolean}[]} containers  L3 domino containers (isBridge = drive-under bridge).
 * @property {{cx:number,cz:number,dir:"N"|"E"|"S"|"W",from:number,to:number}[]} ramps23  2→3 ramps.
 * @property {string[]} bridges  L3 cell keys that are bridges (open ground beneath).
 */

/**
 * Generate level-3 islands + 2→3 ramps + PLANNED bridges (Phase 6 Step 2a/2b).
 *
 * A 2→3 ramp-run is [ lower-lead @L2 ][ ramp on a half-platform (Y2→Y4) ][ landing @L3 ].
 * Solid L3 islands are grown by appending whole CONTAINERS (dominoes) onto the
 * ground (base at Y0, top = Y4 surface) — domino-tileable by construction, and
 * they block the ground beneath them. BRIDGES are placed deliberately first: a
 * ramp lands on a 2-cell bridge whose long-side lanes are reserved as open ground,
 * so cars drive OVER the top and UNDER through the reserved lanes. `minBridges` /
 * `maxBridges` control how many are attempted (graceful if space runs out).
 * Connectivity spans L1 (incl. bridge undersides) + L2 + L3 via ramp edges, so
 * nothing is trapped and every raised surface is reachable.
 *
 * @param {import("./grid.js").Dims} dims
 * @param {Record<string, *>} params
 * @param {string} seed
 * @param {{ pokeCells:Set<string>, level2:string[], ramps:{cx:number,cz:number,dir:string,from:number,to:number}[], reservedL1:string[] }} ctx
 * @returns {Level3Result}
 */
export function generateLevel3(dims, params, seed, ctx) {
	const rng = makeRng(seed, "level3");
	const pokeCells = ctx.pokeCells;
	const L2 = new Set(ctx.level2);
	const reservedL1 = new Set(ctx.reservedL1);
	const ramp12 = new Set(ctx.ramps.filter((r) => r.from === 0).map((r) => key(r.cx, r.cz)));
	const ramps12 = ctx.ramps.filter((r) => r.from === 0);
	const ramp12dir = new Map(ramps12.map((r) => [key(r.cx, r.cz), r.dir]));

	const L3 = new Set();
	const bridgeCells = new Set();   // L3 cells that are bridges (open ground beneath)
	const reservedGround = new Set(); // underpass lanes kept open (blocked from L3)
	const dominoes = [];
	const rampCells23 = new Map();
	const reservedL2 = new Set();
	const COLORS = ["Blue", "Red", "White", "Green"];
	const pick = (a) => a[Math.floor(rng() * a.length)];

	const inB = (x, z) => isInbounds(x, z, dims);
	const isL2 = (x, z) => L2.has(key(x, z));
	const isL3 = (x, z) => L3.has(key(x, z));
	const isBridge = (x, z) => bridgeCells.has(key(x, z));
	/** drivable ground: not poke/L2/1→2-ramp, and not a SOLID L3 (a bridge is open beneath). */
	const isGround = (x, z) => inB(x, z) && !pokeCells.has(key(x, z)) && !isL2(x, z) && !ramp12.has(key(x, z)) && !(isL3(x, z) && !isBridge(x, z));
	/** a ground cell a SOLID L3 container may consume (not a reserved lead/lane, not a bridge). */
	const canL3 = (x, z) => isGround(x, z) && !reservedL1.has(key(x, z)) && !reservedGround.has(key(x, z)) && !isBridge(x, z);
	/**
	 * Is the edge from ground cell (gx,gz) toward (dx,dz) blocked? Walls/pokes, L2,
	 * and solid L3 block; bridge undersides are open. A 1→2 ramp is DIRECTIONAL —
	 * only drivable from its low end — so it walls off its sides and high end.
	 */
	const edgeBlockedGround = (gx, gz, dx, dz) => {
		const nx = gx + dx, nz = gz + dz;
		if (!inB(nx, nz) || pokeCells.has(key(nx, nz)) || isL2(nx, nz) || (isL3(nx, nz) && !isBridge(nx, nz))) return true;
		const rd = ramp12dir.get(key(nx, nz));
		if (rd) { const [ux, uz] = DIR_VEC[rd]; return !(dx === ux && dz === uz); }
		return false;
	};

	/** All drivable cells (L1+L2+L3, linked by 1→2 and 2→3 ramps) one component? */
	function connected() {
		const edges = new Map();
		const addE = (a, b) => { (edges.get(a) || edges.set(a, []).get(a)).push(b); };
		for (const r of ramps12) {
			const [dx, dz] = DIR_VEC[r.dir];
			addE(`1:${r.cx - dx},${r.cz - dz}`, `2:${r.cx + dx},${r.cz + dz}`);
			addE(`2:${r.cx + dx},${r.cz + dz}`, `1:${r.cx - dx},${r.cz - dz}`);
		}
		for (const [rk, dName] of rampCells23) {
			const [rx, rz] = unkey(rk);
			const [dx, dz] = DIR_VEC[dName];
			addE(`2:${rx - dx},${rz - dz}`, `3:${rx + dx},${rz + dz}`);
			addE(`3:${rx + dx},${rz + dz}`, `2:${rx - dx},${rz - dz}`);
		}
		let total = 0;
		let start = null;
		for (let x = 0; x < dims.Wc; x++) for (let z = 0; z < dims.Dc; z++) {
			if (isGround(x, z)) { total++; start = start || `1:${x},${z}`; }
			if (isL2(x, z)) { total++; start = start || `2:${x},${z}`; }
			if (isL3(x, z)) { total++; start = start || `3:${x},${z}`; }
		}
		if (!start) return true;
		const seen = new Set([start]);
		const st = [start];
		while (st.length) {
			const cur = st.pop();
			const lvl = cur[0];
			const [x, z] = cur.slice(2).split(",").map(Number);
			for (const [dx, dz] of Object.values(DIR_VEC)) {
				const nx = x + dx, nz = z + dz;
				let nk = null;
				if (lvl === "1" && isGround(nx, nz)) nk = `1:${nx},${nz}`;
				else if (lvl === "2" && isL2(nx, nz)) nk = `2:${nx},${nz}`;
				else if (lvl === "3" && isL3(nx, nz)) nk = `3:${nx},${nz}`;
				if (nk && !seen.has(nk)) { seen.add(nk); st.push(nk); }
			}
			const re = edges.get(cur);
			if (re) for (const nk of re) if (!seen.has(nk)) { seen.add(nk); st.push(nk); }
		}
		return seen.size === total;
	}

	/** Would newly-L3 cells leave an open ground cell drivable-walled on ≥3 sides? */
	function createsGroundDeadEnd(cells) {
		for (const [cx0, cz0] of cells) {
			for (const [dx, dz] of Object.values(DIR_VEC)) {
				const nx = cx0 + dx, nz = cz0 + dz;
				if (!isGround(nx, nz)) continue;
				let b = 0;
				for (const [ex, ez] of Object.values(DIR_VEC)) if (edgeBlockedGround(nx, nz, ex, ez)) b++;
				if (b >= 3) return true;
			}
		}
		return false;
	}

	/** Commit a container domino (two ground cells → L3) if it keeps things valid. */
	function tryDomino(a, b) {
		L3.add(key(a[0], a[1]));
		L3.add(key(b[0], b[1]));
		if (!connected() || createsGroundDeadEnd([a, b])) {
			L3.delete(key(a[0], a[1]));
			L3.delete(key(b[0], b[1]));
			return false;
		}
		dominoes.push({ cells: [a, b], orient: a[1] === b[1] ? "H" : "V", color: pick(COLORS) });
		return true;
	}

	/** Place one 2→3 ramp + its first (landing) container domino; return landing or null. */
	function placeRamp23() {
		const l2cells = [...L2].map(unkey);
		shuffle(l2cells, rng);
		for (const [rx, rz] of l2cells) {
			if (rampCells23.has(key(rx, rz))) continue;
			for (const [dName, [dx, dz]] of shuffle(Object.entries(DIR_VEC), rng)) {
				const lead = [rx - dx, rz - dz];
				const land = [rx + dx, rz + dz];
				if (!isL2(lead[0], lead[1]) || reservedL2.has(key(lead[0], lead[1]))) continue;
				if (!canL3(land[0], land[1])) continue;
				// Keep ramps apart (no ramp running into another ramp's side).
				if (Object.values(DIR_VEC).some(([ex, ez]) => ramp12.has(key(rx + ex, rz + ez)) || rampCells23.has(key(rx + ex, rz + ez)))) continue;
				let partner = null;
				for (const [ex, ez] of shuffle(Object.values(DIR_VEC), rng)) {
					const p = [land[0] + ex, land[1] + ez];
					if (p[0] === rx && p[1] === rz) continue;
					if (canL3(p[0], p[1])) { partner = p; break; }
				}
				if (!partner) continue;
				rampCells23.set(key(rx, rz), dName);
				reservedL2.add(key(lead[0], lead[1]));
				if (!tryDomino(land, partner)) {
					rampCells23.delete(key(rx, rz));
					reservedL2.delete(key(lead[0], lead[1]));
					continue;
				}
				return land;
			}
		}
		return null;
	}

	/** Grow an L3 island by appending dominoes around it. */
	function growL3(seedCell, budget) {
		let added = 0;
		const frontier = [seedCell];
		while (added < budget && frontier.length) {
			const fi = Math.floor(rng() * frontier.length);
			const [fx, fz] = frontier[fi];
			let grew = false;
			outer:
			for (const [dx, dz] of shuffle(Object.values(DIR_VEC), rng)) {
				const g1 = [fx + dx, fz + dz];
				if (!canL3(g1[0], g1[1])) continue;
				for (const [ex, ez] of shuffle(Object.values(DIR_VEC), rng)) {
					const g2 = [g1[0] + ex, g1[1] + ez];
					if (g2[0] === fx && g2[1] === fz) continue;
					if (!canL3(g2[0], g2[1])) continue;
					if (tryDomino(g1, g2)) { frontier.push(g1, g2); added++; grew = true; break outer; }
				}
			}
			if (!grew) frontier.splice(fi, 1);
		}
		return added;
	}

	/**
	 * Deliberately place ONE planned bridge (Greg's approach): a 2→3 ramp lands on a
	 * bridge domino [A][B] running along the ramp direction, and BOTH long sides of A
	 * and B are open drivable ground that we RESERVE (block from future L3) so the
	 * underpass survives island growth. Top reachable via the ramp; under drivable
	 * across the long sides. Returns true if placed.
	 */
	function placeBridge() {
		const l2cells = [...L2].map(unkey);
		shuffle(l2cells, rng);
		for (const [rx, rz] of l2cells) {
			if (rampCells23.has(key(rx, rz))) continue;
			for (const [dName, [dx, dz]] of shuffle(Object.entries(DIR_VEC), rng)) {
				const lead = [rx - dx, rz - dz];
				const A = [rx + dx, rz + dz];
				const B = [rx + 2 * dx, rz + 2 * dz];
				if (!isL2(lead[0], lead[1]) || reservedL2.has(key(lead[0], lead[1]))) continue;
				if (!canL3(A[0], A[1]) || !canL3(B[0], B[1])) continue;
				// Keep ramps apart (no ramp running into another ramp's side).
				if (Object.values(DIR_VEC).some(([ex, ez]) => ramp12.has(key(rx + ex, rz + ez)) || rampCells23.has(key(rx + ex, rz + ez)))) continue;
				// Long-side lanes = the two directions perpendicular to the run.
				const cross = dx !== 0 ? [[0, -1], [0, 1]] : [[-1, 0], [1, 0]];
				const flanks = [];
				let ok = true;
				for (const cell of [A, B]) for (const [cx2, cz2] of cross) {
					const f = [cell[0] + cx2, cell[1] + cz2];
					if (!isGround(f[0], f[1])) ok = false;
					flanks.push(f);
				}
				if (!ok) continue;
				// Tentatively commit, then validate connectivity + dead-ends; rollback if bad.
				const kA = key(A[0], A[1]), kB = key(B[0], B[1]);
				L3.add(kA); L3.add(kB);
				bridgeCells.add(kA); bridgeCells.add(kB);
				rampCells23.set(key(rx, rz), dName);
				reservedL2.add(key(lead[0], lead[1]));
				const addedReserve = [];
				for (const f of flanks) { const fk = key(f[0], f[1]); if (!reservedGround.has(fk)) { reservedGround.add(fk); addedReserve.push(fk); } }
				if (!connected() || createsGroundDeadEnd([A, B, ...flanks])) {
					L3.delete(kA); L3.delete(kB);
					bridgeCells.delete(kA); bridgeCells.delete(kB);
					rampCells23.delete(key(rx, rz));
					reservedL2.delete(key(lead[0], lead[1]));
					for (const fk of addedReserve) reservedGround.delete(fk);
					continue;
				}
				dominoes.push({ cells: [A, B], orient: dx !== 0 ? "H" : "V", color: pick(COLORS), isBridge: true });
				return true;
			}
		}
		return false;
	}

	const area = dims.Wc * dims.Dc;
	const covMin = params.level3CoverageMin ?? 0.05;
	const covMax = params.level3CoverageMax ?? 0.18;
	const targetCells = Math.round(area * (covMin + rng() * (covMax - covMin)));
	const maxIslands = params.maxIslandsL3 ?? 2;
	const numIslands = 1 + Math.floor(rng() * maxIslands);

	// --- Planned bridges first (they reserve their lanes so islands grow around them). ---
	const minBr = Math.max(0, Math.round(params.minBridges ?? 1));
	const maxBr = Math.max(minBr, Math.round(params.maxBridges ?? 3));
	const bridgeTarget = minBr + Math.floor(rng() * (maxBr - minBr + 1));
	let bridgesPlaced = 0;
	while (bridgesPlaced < bridgeTarget) {
		if (!placeBridge()) break; // graceful: no eligible spot left
		bridgesPlaced++;
	}

	// --- Then solid L3 islands via ramp landings + domino growth. ---
	const seeds = [];
	for (let i = 0; i < numIslands; i++) {
		const s = placeRamp23();
		if (!s) break;
		seeds.push(s);
	}
	if (seeds.length) {
		const budget = Math.ceil(Math.max(0, targetCells - seeds.length * 2) / 2 / seeds.length);
		for (const s of seeds) growL3(s, budget);
	}

	const ramps23 = [...rampCells23.entries()].map(([k, dir]) => { const [cx, cz] = unkey(k); return { cx, cz, dir, from: 2, to: 4 }; });
	return { level3Cells: [...L3], containers: dominoes, ramps23, bridges: [...bridgeCells] };
}

