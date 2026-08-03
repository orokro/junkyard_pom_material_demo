/**
 * ============================================================================
 * arena/gen/tires.js
 * ----------------------------------------------------------------------------
 * Phase 7 — TIRE BARRIERS (ground-level autotiling) + dead-end invariant.
 *
 * Tires are low bumpers placed on open-ground (L1) cells along their boundary
 * with a "solid" mask. Solid = ring/poke walls, L2 half-platforms, and SOLID L3
 * containers. OPEN (never solid) = plain ground, ramps (never block ramp access),
 * and BRIDGE undersides (you drive through). Out-of-bounds counts as solid.
 *
 * Per open-ground cell we emit, from that cell's 4 edges + 4 diagonals:
 *   - "concave" corner when two ADJACENT edges are solid (a two-wall nook). It
 *     covers both those edges and SUPPRESSES straights on them (no doubling), and
 *     renders with the OuterCorner mesh (a big arc that rounds the nook from
 *     outside — "completing the curve from the outside of the tile").
 *   - Straight on each remaining solid edge.
 *   - "convex" corner when a diagonal neighbour is solid but both of its shared
 *     orthogonal edges are open (a wall corner poking into the cell). Renders with
 *     the InnerCorner mesh (concave curve inside the tile, wrapping the poke).
 * Multiple pieces per cell are allowed and common.
 *
 * Bridge pillars sit at the two SHORT ends of each bridge domino, so we add a
 * straight bumper on each of those short-end edges (the ramp-side end abuts a
 * ramp, which is "open", so autotiling wouldn't place it otherwise).
 *
 * Mesh defaults (confirmed via arena_discover): Straight = EAST edge; InnerCorner
 * = NE corner; OuterCorner = NE (full-cell curve). Rotations below map those to
 * every edge/corner. Pure module — Node-testable.
 * ============================================================================
 */

import { key, isInbounds } from "./grid.js";

/** Edge dir → [dx,dz] (north = −Z). */
const DV = { N: [0, -1], E: [1, 0], S: [0, 1], W: [-1, 0] };
/** Corner → its two shared orthogonal edges. */
const CORNERS = { NE: ["N", "E"], SE: ["S", "E"], SW: ["S", "W"], NW: ["N", "W"] };
/** Corner → diagonal neighbour offset. */
const DIAGV = { NE: [1, -1], SE: [1, 1], SW: [-1, 1], NW: [-1, -1] };
/** Straight default sits on the EAST edge → Y-rotation to reach each edge. */
const STRAIGHT_ROT = { E: 0, N: Math.PI / 2, W: Math.PI, S: -Math.PI / 2 };
/** Corner pieces default to NE → Y-rotation to reach each corner. */
const CORNER_ROT = { NE: 0, SE: -Math.PI / 2, SW: Math.PI, NW: Math.PI / 2 };
/** Unit offset → edge name (for bridge pillar short-ends). */
const VEC_DIR = { "0,-1": "N", "1,0": "E", "0,1": "S", "-1,0": "W" };

/**
 * @typedef {object} Tire
 * @property {number} cx @property {number} cz
 * @property {"straight"|"concave"|"convex"} kind
 * @property {string} code  Edge (N/E/S/W) for straight; corner (NE/SE/SW/NW) for corners.
 * @property {number} rotY
 */

/**
 * Autotile tire barriers for a generated arena model.
 * @param {import("./grid.js").Dims} dims
 * @param {import("./arena.js").ArenaModel} model
 * @returns {Tire[]}
 */
export function generateTires(dims, model) {
	// Solid mask at ground level: walls/pokes + solid L3 (story-1, non-bridge) + L2.
	const solid = new Set();
	for (const c of model.containers || []) if (c.story === 1 && !c.bridge) for (const [x, z] of c.cells) solid.add(key(x, z));
	for (const k of model.level2 || []) solid.add(k);
	const rampSet = new Set((model.ramps || []).map((r) => key(r.cx, r.cz)));

	const isSolid = (x, z) => !isInbounds(x, z, dims) || solid.has(key(x, z));
	const isOpenGround = (x, z) => isInbounds(x, z, dims) && !solid.has(key(x, z)) && !rampSet.has(key(x, z));

	/** @type {Tire[]} */
	const tiles = [];
	const seen = new Set();
	const push = (cx, cz, kind, code, rotY) => {
		const id = `${cx},${cz}:${kind}:${code}`;
		if (seen.has(id)) return;
		seen.add(id);
		tiles.push({ cx, cz, kind, code, rotY });
	};

	for (let x = 0; x < dims.Wc; x++) for (let z = 0; z < dims.Dc; z++) {
		if (!isOpenGround(x, z)) continue;
		/** @type {Record<string,boolean>} */
		const sd = {};
		for (const d in DV) { const [dx, dz] = DV[d]; sd[d] = isSolid(x + dx, z + dz); }

		const covered = new Set();
		// Two adjacent solid edges = a concave nook → OuterCorner mesh (rounds it).
		for (const cn in CORNERS) {
			const [e1, e2] = CORNERS[cn];
			if (sd[e1] && sd[e2]) { push(x, z, "concave", cn, CORNER_ROT[cn]); covered.add(e1); covered.add(e2); }
		}
		for (const d in DV) if (sd[d] && !covered.has(d)) push(x, z, "straight", d, STRAIGHT_ROT[d]);
		// Solid diagonal with both orthogonals open = a poking corner → InnerCorner mesh.
		for (const cn in CORNERS) {
			const [e1, e2] = CORNERS[cn];
			const [dx, dz] = DIAGV[cn];
			if (!sd[e1] && !sd[e2] && isSolid(x + dx, z + dz)) push(x, z, "convex", cn, CORNER_ROT[cn]);
		}
	}

	// Bridge pillars: a straight bumper on each short-end edge of every bridge domino.
	for (const c of model.containers || []) {
		if (!c.bridge) continue;
		const [[ax, az], [bx, bz]] = c.cells;
		const abx = bx - ax, abz = bz - az; // A→B (unit along the long axis)
		const ends = [[ax, az, -abx, -abz], [bx, bz, abx, abz]]; // each cell's outward short-end
		for (const [cx, cz, dx, dz] of ends) {
			const dir = VEC_DIR[`${dx},${dz}`];
			// Only where the short-end abuts a NON-solid cell (e.g. the ramp) — a solid
			// short-end is already handled by autotiling (straight/inner corner).
			if (dir && isOpenGround(cx, cz) && !isSolid(cx + dx, cz + dz)) push(cx, cz, "straight", dir, STRAIGHT_ROT[dir]);
		}
	}

	return tiles;
}
