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
 * Terms:
 *   - noise01     : seeded fBm, the base mounds.
 *   - gradientEast: shallow at the western spawn, rising to max potential over
 *                   gradientWidthMeters, then held (Phase 4).
 *   - pathMask    : seeded "lightning" lanes fanning from the spawn edge, held
 *                   at ground level (0) so they cut through the rising junk;
 *                   0 on a path, 1 off, with a smoothstep shoulder of pathBlur
 *                   metres (0 = sheer cliffs) (Phase 5).
 * ============================================================================
 */

import { createFbm } from "./noise.js";
import { makeRng } from "../seed.js";

/** @param {number} v @param {number} lo @param {number} hi @returns {number} */
function clamp(v, lo, hi) {
	return v < lo ? lo : v > hi ? hi : v;
}

/** @param {number} t @returns {number} smoothstep on [0,1]. */
function smoothstep(t) {
	return t * t * (3 - 2 * t);
}

/**
 * Squared distance from point (px,pz) to segment (ax,az)-(bx,bz).
 * @returns {number}
 */
function segDist2(px, pz, ax, az, bx, bz) {
	const dx = bx - ax;
	const dz = bz - az;
	const l2 = dx * dx + dz * dz;
	let t = l2 > 0 ? ((px - ax) * dx + (pz - az) * dz) / l2 : 0;
	t = clamp(t, 0, 1);
	const ex = px - (ax + t * dx);
	const ez = pz - (az + t * dz);
	return ex * ex + ez * ez;
}

/**
 * Generate seeded path polylines fanning east from the spawn edge (0,0).
 * @param {() => number} rng Seeded PRNG.
 * @param {Record<string, *>} cfg World config.
 * @returns {Array<Array<{x: number, z: number}>>} Paths as point lists.
 */
function generatePaths(rng, cfg) {
	const field = cfg.pathWorldSizeMeters ?? 400;
	const stepX = (cfg.pathSegmentStepX ?? 0.1) * field;
	const rangeZ = (cfg.pathSegmentRangeZ ?? 0.2) * field;
	const minSeg = Math.max(1, Math.round(cfg.pathMinSegments ?? 5));
	const maxSeg = Math.max(minSeg, Math.round(cfg.pathMaxSegments ?? 12));
	const count = Math.max(0, Math.round(cfg.numPaths ?? 6));
	const halfZ = field / 2;

	/** @type {Array<Array<{x: number, z: number}>>} */
	const paths = [];
	for (let p = 0; p < count; p++) {
		const segs = minSeg + Math.floor(rng() * (maxSeg - minSeg + 1));
		const pts = [{ x: 0, z: 0 }];
		let x = 0;
		let z = 0;
		for (let s = 0; s < segs; s++) {
			x += stepX;
			z = clamp(z + (rng() * 2 - 1) * rangeZ, -halfZ, halfZ);
			pts.push({ x, z });
		}
		paths.push(pts);
	}
	return paths;
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

	// Path config.
	const pathsEnabled = cfg.pathsEnabled !== false && Math.round(cfg.numPaths ?? 0) > 0;
	const pathThickness = cfg.pathThickness ?? 9;
	const pathBlur = Math.max(0, cfg.pathBlur ?? 6);
	const paths = pathsEnabled ? generatePaths(makeRng(String(cfg.seed), "paths"), cfg) : [];
	const half = pathThickness / 2;
	const pad = half + pathBlur;

	// Path bounding box (+pad) for a cheap early-out.
	let pMinX = Infinity, pMaxX = -Infinity, pMinZ = Infinity, pMaxZ = -Infinity;
	for (const pts of paths) {
		for (const p of pts) {
			if (p.x < pMinX) pMinX = p.x;
			if (p.x > pMaxX) pMaxX = p.x;
			if (p.z < pMinZ) pMinZ = p.z;
			if (p.z > pMaxZ) pMaxZ = p.z;
		}
	}

	/** @param {number} wx @param {number} wz @returns {number} noise mapped to [0,1]. */
	function noise01(wx, wz) {
		const n = fbm(wx / scale, wz / scale) * amplitude;
		return clamp((n + 1) * 0.5, 0, 1);
	}

	/**
	 * Eastward height multiplier: gradStart at x=0 → gradEnd at gradWidth, held.
	 * @param {number} wx World X (east+). @returns {number}
	 */
	function gradientEast(wx) {
		if (!gradEnabled) return 1.0;
		const t = clamp(wx / gradWidth, 0, 1);
		return gradStart + (gradEnd - gradStart) * t;
	}

	/**
	 * Path multiplier: 0 on a path (ground), 1 off, smoothstep shoulder over
	 * pathBlur (0 = sheer). @param {number} wx @param {number} wz @returns {number}
	 */
	function pathMask(wx, wz) {
		if (paths.length === 0) return 1.0;
		if (wx < pMinX - pad || wx > pMaxX + pad || wz < pMinZ - pad || wz > pMaxZ + pad) return 1.0;
		let minD2 = Infinity;
		for (const pts of paths) {
			for (let i = 0; i + 1 < pts.length; i++) {
				const d2 = segDist2(wx, wz, pts[i].x, pts[i].z, pts[i + 1].x, pts[i + 1].z);
				if (d2 < minD2) minD2 = d2;
			}
		}
		const d = Math.sqrt(minD2);
		if (d <= half) return 0.0;
		if (pathBlur <= 0 || d >= half + pathBlur) return d <= half ? 0.0 : 1.0;
		return smoothstep((d - half) / pathBlur);
	}

	/** @param {number} wx @param {number} wz @returns {number} integer meters. */
	function heightAt(wx, wz) {
		const h = maxHeight * gradientEast(wx) * noise01(wx, wz) * pathMask(wx, wz);
		return Math.floor(h);
	}

	/** @param {number} colX @param {number} colZ @returns {number} integer meters. */
	function columnHeight(colX, colZ) {
		return heightAt(colX * 3 + 1.5, colZ * 3 + 1.5);
	}

	return { heightAt, columnHeight, noise01 };
}
