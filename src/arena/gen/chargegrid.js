/**
 * ============================================================================
 * arena/gen/chargegrid.js
 * ----------------------------------------------------------------------------
 * Charge grids (Phase 8): a 4×6 floating "electric ceiling" cars drive under to
 * recharge. Each grid sits over a 1×2-cell footprint at one level (ground / L2 /
 * L3), has TWO kitty-corner attach points, and each attach is held up by a
 * free-standing PILLAR that cantilevers an arm up to it.
 *
 * Support model (no more container mounts):
 *   Pillars ALWAYS stand on the GROUND floor. Three height variants reach the
 *   three grid levels — ChargeGridPillar (ground grids), ChargeGridPillarL2,
 *   ChargeGridPillarL3 — so a raised grid is held by a taller pillar standing on
 *   the ground, hugging the platform it serves. The arm pivot is at
 *   gridLevel + 2.761 m; the extension tip lands on the attach at gridLevel +
 *   2.463 m; horizontal reach is 2.671–4.671 m.
 *
 * Placement rule ("tire band"): pillars only spawn on ground cells that already
 * hug a structure (arena wall, L2 platform, L3 container) — the same strip the
 * tire barriers occupy — so they never stand in the driving lane. They are
 * offset toward that structure (not tile-centred) when reach allows, sit out of
 * the way, never block a ramp, and never spawn on bridges.
 *
 * Pure data; build.js poses the meshes. Deterministic (seeded arena → same grids).
 * ============================================================================
 */

import { CELL, cellCenter, key, isInbounds } from "./grid.js";

const GHX = 1.682, GHZ = 2.680;             // attach offset from grid centre (across, along)
const ATTACH_Y = 2.463, ARM_Y = 2.761;      // heights above the grid's level
const EXT_BASE = 2.671, REACH_MAX = 4.671;  // arm reach range (extension slides 0..2)
const EXT_TIP_DY = -0.023;                   // extension tip Y relative to arm pivot
const PILLAR_HALF = 0.45, HUG_GAP = 0.06;    // pillar footprint half-width; clearance to the wall
const HUG_OFF = CELL / 2 - PILLAR_HALF - HUG_GAP; // offset toward a wall so the pillar hugs it (~1.49 m)
/** Grid level → pillar mesh (taller pillars reach higher grids, all based on the ground). */
const PILLAR_FOR = { 0: "ChargeGridPillar", 2: "ChargeGridPillarL2", 4: "ChargeGridPillarL3" };
const DIRS = [[1, 0], [-1, 0], [0, 1], [0, -1]];

/**
 * @param {import("./arena.js").ArenaModel} model
 * @param {Record<string, *>} params
 * @param {string} seed
 * @returns {object[]} charge-grid placements with resolved world transforms.
 */
export function generateChargeGrids(model, params, seed) {
	const raw = Number(params.chargeGrids);
	const count = Math.max(0, Math.round(Number.isFinite(raw) ? raw : 3)); // preset may omit the key
	if (!count) return [];
	const dims = model.dims;

	const L2 = new Set(model.level2), L3 = new Set(model.level3), BR = new Set(model.bridges);
	const poke = new Set();
	for (const c of model.containers) if (c.story === 1 && !c.ring && !c.level3) for (const [x, z] of c.cells) poke.add(key(x, z));
	const ramp = new Set(model.ramps.map((r) => key(r.cx, r.cz)));
	// Ground cells filled by a container (ring walls, pokes, L3 bases) — solid at ground level.
	const solidGround = new Set();
	for (const c of model.containers) if (c.story === 1 && !c.bridge) for (const [x, z] of c.cells) solidGround.add(key(x, z));
	// Tallest solid top per cell (ring walls up to 2–3 stories, pokes, L3) — used to keep the
	// horizontal arm from cantilevering THROUGH a container that rises into its path.
	const solidHeight = new Map();
	for (const c of model.containers) if (!c.bridge) for (const [x, z] of c.cells) solidHeight.set(key(x, z), Math.max(solidHeight.get(key(x, z)) || 0, c.story * CELL));

	/** Drivable surface level (Y) of a cell, or null if not a clean drivable tile. */
	const levelY = (x, z) => {
		const k = key(x, z);
		if (!isInbounds(x, z, dims)) return null;
		if (BR.has(k) || ramp.has(k) || poke.has(k)) return null; // bridges/ramps/pokes excluded
		if (L3.has(k)) return 4;
		if (L2.has(k)) return 2;
		return 0;
	};
	/** A neighbour a pillar can hug (i.e. where a tire sits): arena wall, container, L2, or L3. */
	const isStructure = (x, z) => !isInbounds(x, z, dims) || solidGround.has(key(x, z)) || L2.has(key(x, z)) || L3.has(key(x, z));

	const occupied = new Set(); // grid footprints + pillar cells consumed (avoid double-use)

	/** A valid pillar base cell: open ground, unused, not a ramp / next to a ramp, and hugging a
	 *  structure (so it stands in the tire band, clear of the driving lane). */
	const pillarCellOK = (x, z) => {
		if (levelY(x, z) !== 0 || occupied.has(key(x, z))) return false;
		let hug = false;
		for (const [dx, dz] of DIRS) {
			if (ramp.has(key(x + dx, z + dz))) return false; // never block a ramp mouth
			if (isStructure(x + dx, z + dz)) hug = true;
		}
		return hug;
	};

	/** Solve arm/extension so the extension tip lands on P from a ground pillar at XZ = M. */
	const solveArm = (M, P, level) => {
		const r = Math.hypot(P[0] - M[0], P[1] - M[1]);
		if (r < EXT_BASE - 0.05 || r > REACH_MAX + 0.05) return null;
		const yaw = Math.atan2(-(P[1] - M[1]), P[0] - M[0]); // arm default points +X
		const armY = level + ARM_Y;
		return { armPos: [M[0], armY, M[1]], armYaw: yaw, extPos: [P[0], armY + EXT_TIP_DY, P[1]], extYaw: yaw, reach: r };
	};

	/** Does the horizontal arm from pillar M to attach P (at height armY) stay clear of
	 *  every container that rises into its path? Samples the XZ segment cell-by-cell. */
	const clearArm = (M, P, armY) => {
		const dist = Math.hypot(P[0] - M[0], P[1] - M[1]);
		const steps = Math.max(2, Math.ceil(dist / 0.5));
		for (let i = 0; i <= steps; i++) {
			const t = i / steps;
			const cx = Math.floor((M[0] + (P[0] - M[0]) * t) / CELL);
			const cz = Math.floor((M[1] + (P[1] - M[1]) * t) / CELL);
			if (!isInbounds(cx, cz, dims)) return false;
			if ((solidHeight.get(key(cx, cz)) || 0) > armY - 0.3) return false; // a container is in the way
		}
		return true;
	};

	/** Best pillar support for attach point P of a grid at `level`. Pure (no reservation). */
	const solveSupport = (P, level, outward) => {
		const pcx = Math.floor(P[0] / CELL), pcz = Math.floor(P[1] / CELL);
		let best = null;
		for (let dx = -4; dx <= 4; dx++) for (let dz = -4; dz <= 4; dz++) {
			const cx = pcx + dx, cz = pcz + dz;
			if (!pillarCellOK(cx, cz)) continue;
			const [ccx, ccz] = cellCenter(cx, cz);
			// Candidate pillar positions: tile centre, plus hugged toward each adjacent structure.
			const cands = [{ pos: [ccx, ccz], hug: 0 }];
			for (const [sx, sz] of DIRS) if (isStructure(cx + sx, cz + sz)) cands.push({ pos: [ccx + sx * HUG_OFF, ccz + sz * HUG_OFF], hug: 1 });
			for (const c of cands) {
				const [mx, mz] = c.pos;
				if ((mx - P[0]) * outward[0] + (mz - P[1]) * outward[1] < 0.2) continue; // arm must not cross the grid
				const sol = solveArm([mx, mz], P, level);
				if (!sol) continue;
				if (!clearArm([mx, mz], P, level + ARM_Y)) continue; // arm would clip a container

				// Prefer a hugged (edge) position, then a shorter arm.
				if (!best || c.hug > best.hug || (c.hug === best.hug && sol.reach < best.reach)) {
					best = { hug: c.hug, reach: sol.reach, cell: [cx, cz], kind: "pillar", variant: PILLAR_FOR[level], pillar: { pos: [mx, 0, mz], rotY: sol.armYaw }, ...sol };
				}
			}
		}
		return best;
	};

	/** Solve both supports for one kitty-corner diagonal. Pure. */
	const buildConfig = (pairs, gc, level, rot) => {
		const attaches = [], supports = [];
		for (const [sx, sz] of pairs) {
			const [ox, oz] = rot(sx * GHX, sz * GHZ);
			const P = [gc[0] + ox, gc[1] + oz];
			const on = Math.hypot(ox, oz) || 1;
			const sup = solveSupport(P, level, [ox / on, oz / on]);
			if (!sup) return null; // both attach points must be supportable
			attaches.push({ pos: [P[0], level + ATTACH_Y, P[1]], rotY: Math.atan2(-oz, ox) });
			supports.push(sup);
		}
		if (supports[0].cell[0] === supports[1].cell[0] && supports[0].cell[1] === supports[1].cell[1]) return null; // no shared cell
		return { attaches, supports, hug: supports.reduce((n, s) => n + s.hug, 0), reach: supports.reduce((n, s) => n + s.reach, 0) };
	};

	/** Try to build a full grid on the 1×2 footprint (cells a,b). */
	const tryGrid = (a, b) => {
		const level = levelY(a[0], a[1]);
		if (level == null || level !== levelY(b[0], b[1])) return null;
		if (occupied.has(key(a[0], a[1])) || occupied.has(key(b[0], b[1]))) return null;
		const horiz = a[1] === b[1]; // cells differ in X → grid rotated 90°, 6 m along X
		const gYaw = horiz ? Math.PI / 2 : 0;
		const [ax, az] = cellCenter(a[0], a[1]), [bx, bz] = cellCenter(b[0], b[1]);
		const gc = [(ax + bx) / 2, (az + bz) / 2];
		const rot = (vx, vz) => gYaw ? [-vz, vx] : [vx, vz]; // +90° about Y maps (x,z)->(-z,x)
		// Try BOTH kitty-corner diagonals; keep the one with more hugged pillars (tidier), then shorter arms.
		const opts = [[[-1, -1], [1, 1]], [[1, -1], [-1, 1]]];
		const built = opts.map((p) => buildConfig(p, gc, level, rot)).filter(Boolean);
		if (!built.length) return null;
		built.sort((c1, c2) => c2.hug - c1.hug || c1.reach - c2.reach);
		const chosen = built[0];
		occupied.add(key(a[0], a[1])); occupied.add(key(b[0], b[1]));
		for (const s of chosen.supports) occupied.add(key(s.cell[0], s.cell[1]));
		return { grid: { pos: [gc[0], level, gc[1]], rotY: gYaw }, level, attaches: chosen.attaches, supports: chosen.supports };
	};

	// Candidate 1×2 footprints.
	const cands = [];
	for (let x = 0; x < dims.Wc; x++) for (let z = 0; z < dims.Dc; z++) {
		if (x + 1 < dims.Wc) cands.push([[x, z], [x + 1, z]]);
		if (z + 1 < dims.Dc) cands.push([[x, z], [x, z + 1]]);
	}
	const ctr = [dims.Wc / 2, dims.Dc / 2];
	const distToCtr = (fp) => Math.hypot((fp[0][0] + fp[1][0]) / 2 + 0.5 - ctr[0], (fp[0][1] + fp[1][1]) / 2 + 0.5 - ctr[1]);
	const fpCentre = (fp) => { const p = cellCenter(fp[0][0], fp[0][1]), q = cellCenter(fp[1][0], fp[1][1]); return [(p[0] + q[0]) / 2, (p[1] + q[1]) / 2]; };

	// The FIRST grid lands near centre; each subsequent grid is placed as far as possible
	// from those already placed (farthest-point sampling) so they spread out.
	const grids = [];
	const placed = [];
	const remaining = cands.slice();
	while (grids.length < count && remaining.length) {
		const ranked = remaining.map((fp) => {
			let score;
			if (!placed.length) score = -distToCtr(fp);
			else { const c = fpCentre(fp); let m = Infinity; for (const p of placed) m = Math.min(m, Math.hypot(c[0] - p[0], c[1] - p[1])); score = m; }
			return { fp, score };
		}).sort((u, v) => v.score - u.score);
		let did = false;
		for (const { fp } of ranked) {
			remaining.splice(remaining.indexOf(fp), 1); // tried → drop (occupied only grows)
			const g = tryGrid(fp[0], fp[1]);
			if (g) { grids.push(g); placed.push([g.grid.pos[0], g.grid.pos[2]]); did = true; break; }
		}
		if (!did) break;
	}
	return grids;
}
