/**
 * ============================================================================
 * arena/gen/chargegrid.js
 * ----------------------------------------------------------------------------
 * Charge grids (Phase 8): a 4×6 floating "electric ceiling" cars drive under to
 * recharge. Each grid sits over a 1×2-cell drivable footprint at one level, has
 * TWO kitty-corner attach points, and each attach point is held up by an arm that
 * either mounts to a nearby CONTAINER face (preferred) or a free-standing PILLAR.
 *
 * All parts are coplanar at the grid's level Y_L: grid pivot on the surface, panel
 * ~2.4 m up, arm pivot 2.761 m up. So the whole solve is 2-D (XZ): put an arm
 * pivot M within the arm's reach [2.671, 4.671] m of the attach point P, on the
 * OUTWARD side (so the arm never crosses the grid), then rotate + slide the arm so
 * its extension tip lands on P.
 *
 * Measurements (from charge_grid.glb, surface-relative metres):
 *   grid attach local offset = (±1.682, +2.463, ±2.680)     [±X across, ±Z along]
 *   arm pivot height = 2.761 ; extension tip base = 2.671 (+0..2 slide → max 4.671)
 *   pillar: 1×1 footprint on the surface, arm pivot at its top-centre
 *   container mount: arm pivot 0.549 m out from the face, −0.219 in Y
 *
 * Pure data; build.js poses the meshes. Deterministic (seeded).
 * ============================================================================
 */

import { makeRng } from "../seed.js";
import { CELL, cellCenter, key, isInbounds } from "./grid.js";

const GHX = 1.682, GHZ = 2.680;          // attach offset from grid centre (across, along)
const ATTACH_Y = 2.463, ARM_Y = 2.761;   // heights above the surface
const EXT_BASE = 2.671, REACH_MAX = 4.671; // arm reach range (extension slides 0..2)
const EXT_TIP_DY = -0.023;                 // extension tip Y relative to arm pivot
const MOUNT_OUT = 0.549, MOUNT_DY = -0.219; // container-mount arm-pivot offset from face

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
	const rng = makeRng(seed, "chargegrid");
	const dims = model.dims;

	const L2 = new Set(model.level2), L3 = new Set(model.level3), BR = new Set(model.bridges);
	const poke = new Set();
	for (const c of model.containers) if (c.story === 1 && !c.ring && !c.level3) for (const [x, z] of c.cells) poke.add(key(x, z));
	const ramp = new Set(model.ramps.map((r) => key(r.cx, r.cz)));
	// Solid container cells with their TALLEST face top (for container-mount candidates).
	// A mount clamps to a continuous wall face; a 2-story ring wall (top Y8) can hold a
	// higher arm than a lone story-1 container (top Y4), so track the max across stories.
	const solidTop = new Map(); // key -> tallest top Y at this cell
	for (const c of model.containers) if (!c.bridge) for (const [x, z] of c.cells) solidTop.set(key(x, z), Math.max(solidTop.get(key(x, z)) || 0, c.story * CELL));

	/** Drivable surface level (Y) of a cell, or null if not drivable / ambiguous. */
	const levelY = (x, z) => {
		const k = key(x, z);
		if (!isInbounds(x, z, dims)) return null;
		if (BR.has(k) || ramp.has(k) || poke.has(k)) return null; // bridges/ramps/pokes excluded
		if (L3.has(k)) return 4;
		if (L2.has(k)) return 2;
		if (!poke.has(k)) return 0; // open ground
		return null;
	};
	const occupied = new Set(); // cells consumed by grids/pillars (no double-use)

	/** Is `cell` a safe pillar spot at level yL (open area, not near a ramp)? */
	const pillarOK = (x, z, yL) => {
		if (levelY(x, z) !== yL || occupied.has(key(x, z))) return false;
		let open = 0;
		for (const [dx, dz] of DIRS) {
			if (ramp.has(key(x + dx, z + dz))) return false; // never block a ramp mouth
			if (levelY(x + dx, z + dz) === yL) open++;
		}
		return open >= 3; // keep pillars in open areas, never in a pinch
	};

	/** Solve arm/extension so the extension tip lands on P from arm-pivot M. */
	const solveArm = (M, P, yL) => {
		const dx = P[0] - M[0], dz = P[1] - M[1];
		const r = Math.hypot(dx, dz);
		if (r < EXT_BASE - 0.05 || r > REACH_MAX + 0.05) return null;
		const yaw = Math.atan2(-dz, dx); // arm default points +X
		const armY = yL + ARM_Y;
		return { armPos: [M[0], armY, M[1]], armYaw: yaw, extPos: [P[0], armY + EXT_TIP_DY, P[1]], extYaw: yaw, reach: r };
	};

	/** Find a support (container mount preferred, else pillar) for attach point P. */
	const solveSupport = (P, yL, outward) => {
		// Candidate arm-pivot cells within reach, biased outward from the grid centre.
		const [pcx, pcz] = [Math.floor(P[0] / CELL), Math.floor(P[1] / CELL)];
		/** @type {{M:number[], cell:number[]}[]} */
		const cand = [];
		for (let dx = -2; dx <= 2; dx++) for (let dz = -2; dz <= 2; dz++) {
			const cx = pcx + dx, cz = pcz + dz;
			const [mx, mz] = cellCenter(cx, cz);
			// Outward test: M must lie beyond P from the grid centre (arm won't cross grid).
			if ((mx - P[0]) * outward[0] + (mz - P[1]) * outward[1] < 0.5) continue;
			const r = Math.hypot(mx - P[0], mz - P[1]);
			if (r < EXT_BASE - 0.05 || r > REACH_MAX + 0.05) continue;
			cand.push({ M: [mx, mz], cell: [cx, cz] });
		}
		cand.sort((a, b) => Math.hypot(a.M[0] - P[0], a.M[1] - P[1]) - Math.hypot(b.M[0] - P[0], b.M[1] - P[1]));

		// 1) Container mount: cell is a solid container whose top clears the arm height.
		for (const { M, cell } of cand) {
			const k = key(cell[0], cell[1]);
			if (!solidTop.has(k) || solidTop.get(k) < yL + ARM_Y - 0.3) continue;
			// Mount on the face pointing back toward P; arm pivot sits MOUNT_OUT off it.
			const toP = [P[0] - M[0], P[1] - M[1]];
			const face = Math.abs(toP[0]) >= Math.abs(toP[1]) ? [Math.sign(toP[0]), 0] : [0, Math.sign(toP[1])];
			const facePt = [cellCenter(cell[0], cell[1])[0] + face[0] * CELL / 2, cellCenter(cell[0], cell[1])[1] + face[1] * CELL / 2];
			const armPivot = [facePt[0] + face[0] * MOUNT_OUT, facePt[1] + face[1] * MOUNT_OUT];
			const sol = solveArm(armPivot, P, yL);
			if (!sol) continue;
			const mountYaw = Math.atan2(-face[1], face[0]);
			return { kind: "mount", mount: { pos: [facePt[0], yL + ARM_Y + MOUNT_DY, facePt[1]], rotY: mountYaw }, ...sol };
		}
		// 2) Pillar: a valid open drivable cell at the same level.
		for (const { M, cell } of cand) {
			if (!pillarOK(cell[0], cell[1], yL)) continue;
			const sol = solveArm(M, P, yL);
			if (!sol) continue;
			occupied.add(key(cell[0], cell[1]));
			const snap = Math.round(sol.armYaw / (Math.PI / 2)) * (Math.PI / 2);
			return { kind: "pillar", pillar: { pos: [M[0], yL, M[1]], rotY: snap }, ...sol };
		}
		return null;
	};

	/** Try to build a full grid on the given 1×2 footprint (cells a,b). */
	const tryGrid = (a, b) => {
		const yL = levelY(a[0], a[1]);
		if (yL == null || yL !== levelY(b[0], b[1])) return null;
		if (occupied.has(key(a[0], a[1])) || occupied.has(key(b[0], b[1]))) return null;
		const horiz = a[1] === b[1]; // cells differ in X → grid rotated 90°, 6 m along X
		const gYaw = horiz ? Math.PI / 2 : 0;
		const [ax, az] = cellCenter(a[0], a[1]);
		const [bx, bz] = cellCenter(b[0], b[1]);
		const gc = [(ax + bx) / 2, (az + bz) / 2];
		// Two kitty-corner attach points (random diagonal). Local (±GHX across, ±GHZ along).
		const flip = rng() < 0.5;
		const pairs = flip ? [[-1, -1], [1, 1]] : [[1, -1], [-1, 1]];
		const rot = (vx, vz) => gYaw ? [-vz, vx] : [vx, vz]; // +90° about Y maps (x,z)->(-z,x)
		const attaches = [];
		const supports = [];
		for (const [sx, sz] of pairs) {
			const [ox, oz] = rot(sx * GHX, sz * GHZ);
			const P = [gc[0] + ox, gc[1] + oz];
			const outward = [ox, oz]; const on = Math.hypot(ox, oz) || 1;
			const sup = solveSupport(P, yL, [ox / on, oz / on]);
			if (!sup) return null; // both supports must solve or the grid is invalid
			// Attach connector faces OUTWARD toward the arm holding it (+X-forward convention).
			attaches.push({ pos: [P[0], yL + ATTACH_Y, P[1]], rotY: Math.atan2(-oz, ox) });
			supports.push(sup);
		}
		occupied.add(key(a[0], a[1])); occupied.add(key(b[0], b[1]));
		return { grid: { pos: [gc[0], yL, gc[1]], rotY: gYaw }, level: yL, attaches, supports };
	};

	// Build the list of candidate footprints, centre-first so a grid lands mid-arena.
	const cands = [];
	for (let x = 0; x < dims.Wc; x++) for (let z = 0; z < dims.Dc; z++) {
		if (x + 1 < dims.Wc) cands.push([[x, z], [x + 1, z]]);
		if (z + 1 < dims.Dc) cands.push([[x, z], [x, z + 1]]);
	}
	const ctr = [dims.Wc / 2, dims.Dc / 2];
	const distToCtr = (fp) => Math.hypot((fp[0][0] + fp[1][0]) / 2 + 0.5 - ctr[0], (fp[0][1] + fp[1][1]) / 2 + 0.5 - ctr[1]);
	// First grid: nearest centre. Rest: shuffled.
	const rest = cands.slice();
	for (let i = rest.length - 1; i > 0; i--) { const j = Math.floor(rng() * (i + 1)); [rest[i], rest[j]] = [rest[j], rest[i]]; }
	rest.sort((a, b) => (a._d ??= distToCtr(a)) - (b._d ??= distToCtr(b)));
	const ordered = [...cands].sort((a, b) => distToCtr(a) - distToCtr(b)).slice(0, 1).concat(rest);

	const grids = [];
	for (const fp of ordered) {
		if (grids.length >= count) break;
		const g = tryGrid(fp[0], fp[1]);
		if (g) grids.push(g);
	}
	return grids;
}
