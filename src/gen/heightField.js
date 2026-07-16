/**
 * ============================================================================
 * gen/heightField.js
 * ----------------------------------------------------------------------------
 * The global terrain height field — a pure function of world coordinates,
 * independent of chunks. Because it is global, adjacent chunks agree at their
 * shared borders automatically (no seam blending, no caching).
 *
 *   height(wx, wz) = quantize( maxHeight · gradientEast(wx) · noise01(wx,wz) · pathMask(wx,wz) )
 *
 * Phase 3.2: noise term only. gradientEast (Phase 4) and pathMask (Phase 5)
 * are identity stubs returning 1.0 until their phases enable them.
 * ============================================================================
 */

import { createFbm } from "./noise.js";

/** @param {number} v @param {number} lo @param {number} hi @returns {number} */
function clamp(v, lo, hi) {
	return v < lo ? lo : v > hi ? hi : v;
}

/**
 * @typedef {object} HeightField
 * @property {(wx: number, wz: number) => number} heightAt Integer meters at world XZ.
 * @property {(colX: number, colZ: number) => number} columnHeight Integer meters at a column index.
 * @property {(wx: number, wz: number) => number} noise01 Raw noise term in [0,1].
 */

/**
 * Build the height field from a world config.
 * @param {Record<string, *>} cfg World-generation config.
 * @returns {HeightField} Height field.
 */
export function createHeightField(cfg) {
	const fbm = createFbm(String(cfg.seed), {
		octaves: cfg.noiseOctaves,
		lacunarity: cfg.noiseLacunarity,
		persistence: cfg.noisePersistence,
	});
	const scale = Math.max(1, cfg.noiseScale);
	const amplitude = cfg.noiseAmplitude ?? 1;
	const maxHeight = cfg.maxHeightMeters;

	// Eastward gradient config.
	const gradEnabled = cfg.gradientEnabled !== false;
	const gradStart = cfg.gradientStart ?? 0.02;
	const gradEnd = cfg.gradientEnd ?? 1.0;
	const gradWidth = Math.max(1, cfg.gradientWidthMeters ?? 200);

	/** @param {number} wx @param {number} wz @returns {number} noise mapped to [0,1]. */
	function noise01(wx, wz) {
		const n = fbm(wx / scale, wz / scale) * amplitude;
		return clamp((n + 1) * 0.5, 0, 1);
	}

	/**
	 * Eastward height multiplier: gradStart at the western edge (x=0), lerping to
	 * gradEnd at gradWidth meters east, then held at gradEnd. Multiplies the
	 * noise so the junkyard starts shallow at spawn and rises toward max height.
	 * @param {number} wx World X (east+).
	 * @returns {number} Multiplier in [gradStart, gradEnd].
	 */
	function gradientEast(wx) {
		if (!gradEnabled) return 1.0;
		const t = clamp(wx / gradWidth, 0, 1);
		return gradStart + (gradEnd - gradStart) * t;
	}

	// Identity stub — enabled in Phase 5.
	/** @returns {number} */
	function pathMask() {
		return 1.0;
	}

	/** @param {number} wx @param {number} wz @returns {number} integer meters. */
	function heightAt(wx, wz) {
		const h = maxHeight * gradientEast(wx) * noise01(wx, wz) * pathMask(wx, wz);
		return Math.floor(h);
	}

	/** @param {number} colX @param {number} colZ @returns {number} integer meters. */
	function columnHeight(colX, colZ) {
		// Sample at the column center (columns are 3 m).
		return heightAt(colX * 3 + 1.5, colZ * 3 + 1.5);
	}

	return { heightAt, columnHeight, noise01 };
}
