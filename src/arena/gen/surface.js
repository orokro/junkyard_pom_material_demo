/**
 * ============================================================================
 * arena/gen/surface.js
 * ----------------------------------------------------------------------------
 * Deterministic surface-height sampler for walk mode. Given a world XZ, returns
 * the top Y of whatever the player is standing on:
 *   ground/L1 → 0, level-2 platform → 2, level-3 / container-top / poke → 4,
 *   ramp → linearly interpolated between its low and high edges.
 *
 * Cheaper + deterministic vs raycasting. Pure module (Node-testable).
 * ============================================================================
 */

import { CELL, key } from "./grid.js";

/**
 * Build a sampler for a generated arena model.
 * @param {import("./arena.js").ArenaModel} model
 * @returns {(x:number, z:number) => number} top Y at world XZ.
 */
export function makeSurfaceSampler(model) {
	const level2 = new Set(model.level2 || []);
	const level3 = new Set(model.level3 || []);
	const tops4 = new Set(); // in-bounds container/poke cells: top at Y=4
	for (const c of model.containers || []) {
		if (c.story === 1 && !c.ring) for (const [x, z] of c.cells) tops4.add(key(x, z));
	}
	/** @type {Map<string,{dir:string,from:number}>} */
	const ramps = new Map();
	for (const r of model.ramps || []) ramps.set(key(r.cx, r.cz), r);

	return function surfaceAt(x, z) {
		const cx = Math.floor(x / CELL);
		const cz = Math.floor(z / CELL);
		const k = key(cx, cz);
		const r = ramps.get(k);
		if (r) {
			const u = x / CELL - cx; // 0..1 west→east (+X)
			const v = z / CELL - cz; // 0..1 north→south (+Z)
			let t; // 0 at low edge, 1 at high edge (high is toward the up-direction)
			switch (r.dir) {
				case "N": t = 1 - v; break; // high at north (−Z, v small)
				case "S": t = v; break;
				case "E": t = u; break;
				case "W": t = 1 - u; break;
				default: t = 0;
			}
			const base = r.from === 2 ? 2 : 0;
			return base + 2 * Math.max(0, Math.min(1, t));
		}
		if (tops4.has(k) || level3.has(k)) return 4;
		if (level2.has(k)) return 2;
		return 0;
	};
}
