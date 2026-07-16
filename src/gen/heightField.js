/**
 * ============================================================================
 * gen/heightField.js
 * ----------------------------------------------------------------------------
 * Global terrain height field — a pure function of world coordinates.
 *
 *   height = quantize( maxH · gradientEast · noise01 · spawnPathMask
 *                            · pitsFactor · pathsBiomeFactor )
 *
 * Terms:
 *   - noise01        : seeded fBm — the base mounds.
 *   - gradientEast   : shallow at spawn, rising east (Phase 4).
 *   - pathMask       : seeded "lightning" lanes from spawn (Phase 5).
 *   - biomes         : overlapping regional fields (rust/tire/pits/paths), each
 *                      a large-scale fBm thresholded + normalised to 0..1.
 *   - pitsFactor     : where the pits biome is active, a holey noise punches
 *                      ground-level holes even in tall terrain.
 *   - pathsBiomeFactor: where the paths biome is active, Worley F1-edge lanes
 *                      drop to ground — connected canyon networks.
 *
 * `biomesAt(wx,wz)` is exposed for the (later) per-column shader + structure
 * placement — terrain here only consumes pits + paths.
 * ============================================================================
 */

import { createFbm, createWorley2D } from "./noise.js";
import { makeRng } from "../seed.js";

/** @param {number} v @param {number} lo @param {number} hi @returns {number} */
function clamp(v, lo, hi) {
	return v < lo ? lo : v > hi ? hi : v;
}
/** @param {number} a @param {number} b @param {number} t @returns {number} */
function mix(a, b, t) {
	return a + (b - a) * t;
}
/** @param {number} a @param {number} b @param {number} x @returns {number} */
function smoothstep(a, b, x) {
	const t = clamp((x - a) / (b - a), 0, 1);
	return t * t * (3 - 2 * t);
}

/**
 * Generate seeded path polylines fanning east from the spawn edge (0,0).
 * @param {() => number} rng @param {Record<string, *>} cfg
 * @returns {Array<Array<{x: number, z: number}>>}
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

/** Squared distance from (px,pz) to segment (ax,az)-(bx,bz). */
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
 * @typedef {object} Biomes
 * @property {number} rust
 * @property {number} tire
 * @property {number} pits
 * @property {number} paths
 */

/**
 * @typedef {object} HeightField
 * @property {(wx: number, wz: number) => number} heightAt
 * @property {(colX: number, colZ: number) => number} columnHeight
 * @property {(wx: number, wz: number) => number} noise01
 * @property {(wx: number, wz: number) => Biomes} biomesAt
 */

/**
 * Build the height field from a world config.
 * @param {Record<string, *>} cfg
 * @returns {HeightField}
 */
export function createHeightField(cfg) {
	const seed = String(cfg.seed);
	const fbm = createFbm(seed, {
		octaves: cfg.noiseOctaves,
		lacunarity: cfg.noiseLacunarity,
		persistence: cfg.noisePersistence,
	});
	const scale = Math.max(1, cfg.noiseScale);
	const amplitude = cfg.noiseAmplitude ?? 1;
	const maxHeight = cfg.maxHeightMeters;

	// Eastward gradient.
	const gradEnabled = cfg.gradientEnabled !== false;
	const gradStart = cfg.gradientStart ?? 0.02;
	const gradEnd = cfg.gradientEnd ?? 1.0;
	const gradWidth = Math.max(1, cfg.gradientWidthMeters ?? 200);

	// Spawn paths.
	const spawnPathsEnabled = cfg.pathsEnabled !== false && Math.round(cfg.numPaths ?? 0) > 0;
	const pathThickness = cfg.pathThickness ?? 9;
	const pathBlur = Math.max(0, cfg.pathBlur ?? 6);
	const spawnPaths = spawnPathsEnabled ? generatePaths(makeRng(seed, "paths"), cfg) : [];
	const half = pathThickness / 2;
	const pad = half + pathBlur;
	let pMinX = Infinity, pMaxX = -Infinity, pMinZ = Infinity, pMaxZ = -Infinity;
	for (const pts of spawnPaths) for (const p of pts) {
		if (p.x < pMinX) pMinX = p.x;
		if (p.x > pMaxX) pMaxX = p.x;
		if (p.z < pMinZ) pMinZ = p.z;
		if (p.z > pMaxZ) pMaxZ = p.z;
	}

	// Biomes.
	const biomesEnabled = cfg.biomesEnabled !== false;
	const biomeScale = Math.max(1, cfg.biomeScale ?? 350);
	const rustThreshold = cfg.rustThreshold ?? 0.5;
	const tireThreshold = cfg.tireThreshold ?? 0.5;
	const pitsThreshold = cfg.pitsThreshold ?? 0.55;
	const pathBiomeThreshold = cfg.pathThreshold ?? 0.5;
	const pitsHoleScale = Math.max(1, cfg.pitsHoleScale ?? 110);
	const pitsDepth = cfg.pitsDepth ?? 0.9;
	const pathCellScale = Math.max(1, cfg.pathCellScale ?? 170);
	const pathWidth = cfg.pathWidth ?? 0.12;

	const presenceOpts = { octaves: 2, lacunarity: 2, persistence: 0.5 };
	const bRust = createFbm(seed, presenceOpts, "biome_rust");
	const bTire = createFbm(seed, presenceOpts, "biome_tire");
	const bPits = createFbm(seed, presenceOpts, "biome_pits");
	const bPaths = createFbm(seed, presenceOpts, "biome_paths");
	const holeFbm = createFbm(seed, { octaves: 3, lacunarity: 2, persistence: 0.5 }, "pits_holes");
	const worley = createWorley2D(seed, "path_cells");

	/** @param {(x:number,y:number)=>number} fn @param {number} threshold @param {number} wx @param {number} wz */
	function biomeScalar(fn, threshold, wx, wz) {
		const n = (fn(wx / biomeScale, wz / biomeScale) + 1) * 0.5;
		return n <= threshold ? 0 : (n - threshold) / (1 - threshold);
	}

	/** @param {number} wx @param {number} wz @returns {Biomes} */
	function biomesAt(wx, wz) {
		if (!biomesEnabled) return { rust: 0, tire: 0, pits: 0, paths: 0 };
		return {
			rust: biomeScalar(bRust, rustThreshold, wx, wz),
			tire: biomeScalar(bTire, tireThreshold, wx, wz),
			pits: biomeScalar(bPits, pitsThreshold, wx, wz),
			paths: biomeScalar(bPaths, pathBiomeThreshold, wx, wz),
		};
	}

	/** @param {number} wx @param {number} wz @returns {number} noise in [0,1]. */
	function noise01(wx, wz) {
		const n = fbm(wx / scale, wz / scale) * amplitude;
		return clamp((n + 1) * 0.5, 0, 1);
	}

	/** @param {number} wx @returns {number} */
	function gradientEast(wx) {
		if (!gradEnabled) return 1.0;
		return gradStart + (gradEnd - gradStart) * clamp(wx / gradWidth, 0, 1);
	}

	/** @param {number} wx @param {number} wz @returns {number} */
	function spawnPathMask(wx, wz) {
		if (spawnPaths.length === 0) return 1.0;
		if (wx < pMinX - pad || wx > pMaxX + pad || wz < pMinZ - pad || wz > pMaxZ + pad) return 1.0;
		let minD2 = Infinity;
		for (const pts of spawnPaths) {
			for (let i = 0; i + 1 < pts.length; i++) {
				const d2 = segDist2(wx, wz, pts[i].x, pts[i].z, pts[i + 1].x, pts[i + 1].z);
				if (d2 < minD2) minD2 = d2;
			}
		}
		const d = Math.sqrt(minD2);
		if (d <= half) return 0.0;
		if (pathBlur <= 0 || d >= half + pathBlur) return 1.0;
		return smoothstep(0, 1, (d - half) / pathBlur);
	}

	/**
	 * Pits biome: a holey noise mask that reaches 0 (ground) where the noise is
	 * below `pitsDepth`. `eff` ramps the effect to full in the region interior so
	 * it blends at edges but truly punches to ground in the middle.
	 */
	function pitsFactor(wx, wz, pits) {
		if (pits <= 0) return 1;
		const h = (holeFbm(wx / pitsHoleScale, wz / pitsHoleScale) + 1) * 0.5;
		// Pockets form only at the noise *peaks* (isolated), so pit-hole-size
		// controls pocket size. `pitsDepth` = density, mapped to a cutoff that is
		// capped at 0.45 so a region can never fully flatten.
		const cut = mix(0.85, 0.45, clamp(pitsDepth, 0, 1));
		const pocket = smoothstep(cut, cut + 0.08, h); // 1 at peaks → pocket
		const eff = smoothstep(0, 0.25, pits); // region body, soft edges
		return mix(1, 1 - pocket, eff);
	}

	/** Paths biome: Worley F1-edge lanes drop to ground (0) in the region interior. */
	function pathsBiomeFactor(wx, wz, paths) {
		if (paths <= 0) return 1;
		const [f1, f2] = worley(wx / pathCellScale, wz / pathCellScale);
		const lane = smoothstep(0, pathWidth, f2 - f1); // 0 at cell edges → ground lane
		const eff = smoothstep(0, 0.25, paths); // full effect across the region body, soft edges
		return mix(1, lane, eff);
	}

	/** @param {number} wx @param {number} wz @returns {number} integer meters. */
	function heightAt(wx, wz) {
		let h = maxHeight * gradientEast(wx) * noise01(wx, wz) * spawnPathMask(wx, wz);
		if (biomesEnabled) {
			const pits = biomeScalar(bPits, pitsThreshold, wx, wz);
			const paths = biomeScalar(bPaths, pathBiomeThreshold, wx, wz);
			if (pits > 0) h *= pitsFactor(wx, wz, pits);
			if (paths > 0) h *= pathsBiomeFactor(wx, wz, paths);
		}
		return Math.floor(h);
	}

	/** @param {number} colX @param {number} colZ @returns {number} */
	function columnHeight(colX, colZ) {
		return heightAt(colX * 3 + 1.5, colZ * 3 + 1.5);
	}

	return { heightAt, columnHeight, noise01, biomesAt };
}
