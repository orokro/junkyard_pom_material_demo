/**
 * ============================================================================
 * arena/gen/props.js
 * ----------------------------------------------------------------------------
 * Environment decoration: stadium lights ringing the arena (facing in) and
 * EZ-up tents scattered on the outer-wall container tops. Pure data — build.js
 * turns these into instances. Deterministic (seeded).
 * ============================================================================
 */

import { makeRng } from "../seed.js";
import { CELL, cellCenter, key } from "./grid.js";

/** EZ-up tent-top colors (RGB 0..1) — random per tent for visual variety. */
const TENT_COLORS = [
	[0.82, 0.12, 0.12], [0.13, 0.33, 0.78], [0.90, 0.90, 0.92],
	[0.12, 0.58, 0.24], [0.92, 0.52, 0.10], [0.85, 0.76, 0.14], [0.5, 0.15, 0.6],
];

/**
 * Stadium lights spaced around the arena, standing outside the walls, facing in.
 * @param {import("./grid.js").Dims} dims
 * @param {Record<string, *>} params
 * @param {string} seed
 * @returns {{pos:[number,number,number], rotY:number, scale:number}[]}
 */
export function placeStadiumLights(dims, params, seed) {
	const count = Math.max(0, Math.round(params.stadiumLights ?? 10));
	if (!count) return [];
	const scale = params.stadiumLightScale ?? 1;
	const margin = params.stadiumLightMargin ?? 18; // metres beyond the in-bounds rect
	const minX = -margin, maxX = dims.Wc * CELL + margin;
	const minZ = -margin, maxZ = dims.Dc * CELL + margin;
	const cx = (minX + maxX) / 2, cz = (minZ + maxZ) / 2;
	const w = maxX - minX, h = maxZ - minZ, perim = 2 * (w + h);
	const lights = [];
	for (let i = 0; i < count; i++) {
		// Walk the rectangle perimeter at even intervals (offset half-step to avoid corners).
		let t = ((i + 0.5) / count) * perim;
		let x, z;
		if (t < w) { x = minX + t; z = minZ; }
		else if ((t -= w) < h) { x = maxX; z = minZ + t; }
		else if ((t -= h) < w) { x = maxX - t; z = maxZ; }
		else { t -= w; x = minX; z = maxZ - t; }
		// Face the arena centre. Mesh's light head points +X by default.
		const dx = cx - x, dz = cz - z;
		const rotY = Math.atan2(-dz, dx);
		lights.push({ pos: [x, 0, z], rotY, scale });
	}
	return lights;
}

/**
 * EZ-up tents on the outer-wall container tops (0/1/2 per 2-cell container), each
 * a random cell of the footprint, random facing + random top colour.
 * @param {{ groundFrame: import("./rings.js").Container[], upper: import("./rings.js").Container[] }} rings
 * @param {import("./grid.js").Dims} dims
 * @param {Record<string, *>} params
 * @param {string} seed
 * @returns {{pos:[number,number,number], rotY:number, color:number[]}[]}
 */
export function placeTents(rings, dims, params, seed) {
	const rng = makeRng(seed, "tents");
	const chance = params.tentChance ?? 0.3; // per top cell
	const jitter = (5 * Math.PI) / 180; // tents are square + fill a 4×4 cell — only a hair of rotation
	const upperIdx = new Set();
	for (const u of rings.upper) if (u.ground != null) upperIdx.add(u.ground);
	const tents = [];
	rings.groundFrame.forEach((c, i) => {
		const topY = (upperIdx.has(i) ? 2 : 1) * CELL; // top of the tallest container here
		for (const [cxi, czi] of c.cells) {
			if (rng() >= chance) continue;
			const [x, z] = cellCenter(cxi, czi);
			tents.push({ pos: [x, topY, z], rotY: (rng() * 2 - 1) * jitter, color: TENT_COLORS[Math.floor(rng() * TENT_COLORS.length)] });
		}
	});
	return tents;
}
