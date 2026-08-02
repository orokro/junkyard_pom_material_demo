/**
 * ============================================================================
 * arena/gen/grid.js
 * ----------------------------------------------------------------------------
 * Grid domain + coordinate helpers for the Arena POC.
 *
 * The arena is a grid of 4 m cells. In-bounds (playable) cells are
 * [0..Wc-1] x [0..Dc-1]. Outer rings + OOB fill live at negative indices and
 * beyond Wc/Dc. World space: +X east, +Z south, +Y up. Cell (cx,cz) spans world
 * X:[cx*4, cx*4+4], Z:[cz*4, cz*4+4]; its center is (cx*4+2, y, cz*4+2).
 *
 * Pure module — no Three.js / DOM — so it is unit-testable under plain Node.
 * ============================================================================
 */

import { makeRng } from "../seed.js";

export const CELL = 4; // meters per grid cell edge

/**
 * @typedef {object} Dims
 * @property {number} Wc  In-bounds width in cells (east/west, X).
 * @property {number} Dc  In-bounds depth in cells (north/south, Z).
 * @property {number} ratio  Chosen aspect ratio (width / depth).
 */

/**
 * Choose in-bounds cell dimensions from the seed + params.
 * Diagonal is fixed by arenaSizeMeters; a random aspect ratio (w/d) in
 * [aspectMin, aspectMax] shapes the rectangle, then we quantize to whole cells.
 * @param {string} seed
 * @param {Record<string, *>} params
 * @returns {Dims}
 */
export function computeDims(seed, params) {
	const rng = makeRng(seed, "shape");
	const aMin = params.aspectMin ?? 0.5;
	const aMax = params.aspectMax ?? 2.0;
	const ratio = aMin + rng() * (aMax - aMin);
	const diag = params.arenaSizeMeters ?? 60;
	const d = diag / Math.sqrt(ratio * ratio + 1);
	const w = ratio * d;
	const min = params.minInboundsCells ?? 5;
	const Wc = Math.max(min, Math.round(w / CELL));
	const Dc = Math.max(min, Math.round(d / CELL));
	return { Wc, Dc, ratio };
}

/** @param {number} cx @param {number} cz @returns {string} stable cell key. */
export const key = (cx, cz) => `${cx},${cz}`;

/** @param {string} k @returns {[number, number]} parse a cell key. */
export const unkey = (k) => k.split(",").map(Number);

/**
 * World-space center of a cell.
 * @param {number} cx @param {number} cz @returns {[number, number]} [x, z]
 */
export function cellCenter(cx, cz) {
	return [cx * CELL + CELL / 2, cz * CELL + CELL / 2];
}

/**
 * In-bounds world rectangle (for the camera clamp + floor extents).
 * @param {Dims} dims @returns {{minX:number,maxX:number,minZ:number,maxZ:number}}
 */
export function inboundsRect(dims) {
	return { minX: 0, maxX: dims.Wc * CELL, minZ: 0, maxZ: dims.Dc * CELL };
}

/**
 * Is a cell inside the in-bounds playable rectangle?
 * @param {number} cx @param {number} cz @param {Dims} dims @returns {boolean}
 */
export function isInbounds(cx, cz, dims) {
	return cx >= 0 && cz >= 0 && cx < dims.Wc && cz < dims.Dc;
}

/**
 * Cells forming the outer wall band: a frame of `ringWidth` cells wrapping the
 * in-bounds rectangle (outside it).
 * @param {Dims} dims @param {number} [ringWidth]
 * @returns {[number, number][]} list of [cx, cz]
 */
export function ringBandCells(dims, ringWidth = 2) {
	const cells = [];
	for (let cx = -ringWidth; cx < dims.Wc + ringWidth; cx++) {
		for (let cz = -ringWidth; cz < dims.Dc + ringWidth; cz++) {
			if (!isInbounds(cx, cz, dims)) cells.push([cx, cz]);
		}
	}
	return cells;
}
