/**
 * ============================================================================
 * arena/gen/bridges.js
 * ----------------------------------------------------------------------------
 * Phase 6 Step 2b — BRIDGES pass.
 *
 * A bridge is an existing level-3 container domino whose UNDERSIDE is opened: you
 * drive OVER the top (still a Y4 surface, reached by the same 2→3 ramps) AND
 * UNDER it at ground level. The `Arena_Bridge` mesh has its pillars at the two
 * short ends, so the tunnel runs across the domino's LONG sides (the cross axis).
 *
 * Eligibility (from the plan): convert an L3 domino to a bridge only where a real
 * through-lane passes beneath it — i.e. some cell of the domino has drivable L1
 * ground on BOTH of its long sides. That guarantees "not a bridge-to-nowhere"
 * and, because opening ground only ADDS drivability (never removes it), the
 * single-connected-component invariant is preserved by construction.
 *
 * Bridges chain: once a domino is promoted, the ground it opened counts as a
 * drivable long-side for its neighbours, so adjacent dominoes can become bridges
 * too (double bridges / longer tunnels). We iterate to a fixed point.
 *
 * Pure module (no Three.js / DOM) — Node-testable.
 * ============================================================================
 */

import { makeRng } from "../seed.js";
import { key, unkey, isInbounds } from "./grid.js";

/** Orientation → the two cross-axis (long-side) directions the tunnel opens onto. */
const CROSS = { H: [[0, -1], [0, 1]], V: [[-1, 0], [1, 0]] };
const DIRS = [[1, 0], [-1, 0], [0, 1], [0, -1]];

/** @template T @param {T[]} a @param {() => number} rng @returns {T[]} */
function shuffle(a, rng) {
	for (let i = a.length - 1; i > 0; i--) {
		const j = Math.floor(rng() * (i + 1));
		[a[i], a[j]] = [a[j], a[i]];
	}
	return a;
}

/**
 * @typedef {object} BridgeResult
 * @property {{cells:[[number,number],[number,number]],orient:"H"|"V",color:string}[]} bridges  Dominoes promoted to bridges.
 * @property {string[]} bridgeCells  Cell keys whose ground is now an open underpass.
 */

/**
 * Promote eligible level-3 container dominoes to bridges.
 * @param {import("./grid.js").Dims} dims
 * @param {Record<string, *>} params
 * @param {string} seed
 * @param {{ pokeCells:Set<string>, level2:string[], level3:string[], ramps:{cx:number,cz:number,dir:string,from:number,to:number}[], level3Containers:{cells:[[number,number],[number,number]],orient:"H"|"V",color:string}[] }} ctx
 * @returns {BridgeResult}
 */
export function promoteBridges(dims, params, seed, ctx) {
	const rng = makeRng(seed, "bridges");
	const pokeCells = ctx.pokeCells;
	const L2 = new Set(ctx.level2);
	const L3 = new Set(ctx.level3);
	const ramp12 = new Set(ctx.ramps.filter((r) => r.from === 0).map((r) => key(r.cx, r.cz)));
	const chance = params.bridgeChance ?? 0.5;

	/** Cells whose ground has been opened (bridge underpass). */
	const bridgeSet = new Set();

	const inB = (x, z) => isInbounds(x, z, dims);
	/** Blocks ground movement: walls/pokes, L2 fillers, solid (non-bridge) L3, 1→2 ramps. */
	const groundBlocked = (x, z) => {
		const k = key(x, z);
		return pokeCells.has(k) || L2.has(k) || (L3.has(k) && !bridgeSet.has(k)) || ramp12.has(k);
	};
	/** Drivable at ground level (a bridge's own cell is open beneath). */
	const openGround = (x, z) => inB(x, z) && !groundBlocked(x, z);

	/** Does a straight lane pass under this domino (some cell open on both long sides)? */
	function hasThroughLane(c) {
		const [cd0, cd1] = CROSS[c.orient];
		return c.cells.some(([x, z]) =>
			openGround(x + cd0[0], z + cd0[1]) && openGround(x + cd1[0], z + cd1[1]));
	}

	/**
	 * With the given cells already opened (added to bridgeSet), does any open-ground
	 * cell — the new undersides or a neighbour — end up walled on ≥3 sides? Opening
	 * a domino's SECOND cell can otherwise leave it a 1×1 stub tunnel.
	 */
	function createsDeadEnd(cells) {
		const check = new Set();
		for (const [x, z] of cells) { check.add(key(x, z)); for (const [dx, dz] of DIRS) check.add(key(x + dx, z + dz)); }
		for (const kk of check) {
			const [x, z] = unkey(kk);
			if (!openGround(x, z)) continue;
			let b = 0;
			for (const [dx, dz] of DIRS) if (!openGround(x + dx, z + dz)) b++;
			if (b >= 3) return true;
		}
		return false;
	}

	// Decide desire once per domino (deterministic); eligibility is re-checked each
	// pass so a domino freed up by a neighbour's underpass can still convert.
	const candidates = shuffle(ctx.level3Containers.slice(), rng);
	const wants = new Map(candidates.map((c) => [c, rng() < chance]));
	const done = new Set();

	let changed = true;
	let guard = 0;
	while (changed && guard++ < 6) {
		changed = false;
		for (const c of candidates) {
			if (done.has(c) || !wants.get(c)) continue;
			if (!hasThroughLane(c)) continue;
			const ks = c.cells.map(([x, z]) => key(x, z));
			ks.forEach((k) => bridgeSet.add(k));
			if (createsDeadEnd(c.cells)) { ks.forEach((k) => bridgeSet.delete(k)); continue; }
			done.add(c);
			changed = true;
		}
	}

	const bridges = candidates.filter((c) => done.has(c)).map((c) => ({ cells: c.cells, orient: c.orient, color: c.color }));
	return { bridges, bridgeCells: [...bridgeSet] };
}
