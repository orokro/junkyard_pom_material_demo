/**
 * ============================================================================
 * gen/placeStructures.js
 * ----------------------------------------------------------------------------
 * Deterministic per-chunk structure placement.
 *
 * The chunk-centre biome scalars gate which biome pools are active; a budget
 * scaled by biome-ness (additive, capped at maxStructuresPerChunk) places biome
 * items, and each global item rolls its odds (crane also gated by chunk modulo).
 * A claimed-grid prevents overlap. 1×1 items get a random 90° rotation; larger
 * items check their footprint from a seed-random start direction to avoid an
 * orientation bias, and only sit on cells of similar, non-steep height.
 *
 * Returns placements: { item, x, z, y, rotY } where (x,z) is the SW-corner
 * pivot world position and y the surface height.
 * ============================================================================
 */

import { cyrb128, mulberry32 } from "../seed.js";

const HALF_PI = Math.PI / 2;

/** @param {number} a @param {number} n @returns {number} positive modulo. */
function pmod(a, n) {
	return ((a % n) + n) % n;
}

/**
 * @typedef {object} Placement
 * @property {import("../three/structures.js").StructureItem} item
 * @property {number} x  Pivot world X.
 * @property {number} z  Pivot world Z.
 * @property {number} y  Surface height.
 * @property {number} rotY  Rotation (radians).
 */

/**
 * Place structures for a chunk.
 * @param {number} cx @param {number} cz
 * @param {{worldConfig: Record<string, *>, heightField: *, structures: import("../three/structures.js").StructureRegistry}} ctx
 * @returns {Placement[]}
 */
export function placeStructures(cx, cz, ctx) {
	const { worldConfig, heightField, structures } = ctx;
	if (!structures || worldConfig.structuresEnabled === false) return [];

	const seed = String(worldConfig.seed);
	const cs = Math.round(worldConfig.chunkSize);
	const maxStructures = Math.max(0, Math.round(worldConfig.maxStructuresPerChunk ?? 8));
	const globalOdds = worldConfig.globalOdds ?? 8;
	const rng = mulberry32(cyrb128(`${seed}_struct_${cx}_${cz}`)[0]);

	const centerX = (cx * cs + cs / 2) * 3;
	const centerZ = (cz * cs + cs / 2) * 3;
	const biome = heightField.biomesAt(centerX, centerZ);

	/** @type {import("../three/structures.js").StructureItem[]} */
	const pool = [];
	if (biome.tire > 0) pool.push(...structures.tire);
	if (biome.rust > 0) pool.push(...structures.rust);

	/** @type {Set<string>} */
	const claimed = new Set();
	/** @type {Placement[]} */
	const placements = [];

	/** @param {number} lx @param {number} lz */
	function cellInfo(lx, lz) {
		const gx = cx * cs + lx;
		const gz = cz * cs + lz;
		const nw = heightField.heightAt(gx * 3, gz * 3);
		const ne = heightField.heightAt((gx + 1) * 3, gz * 3);
		const sw = heightField.heightAt(gx * 3, (gz + 1) * 3);
		const se = heightField.heightAt((gx + 1) * 3, (gz + 1) * 3);
		const lo = Math.min(nw, ne, sw, se);
		// `top` = the cell's rendered base (lowest corner = where the solid tile
		// sits), so structures seat on the tile floor instead of floating on the
		// center-sampled noise.
		return { span: Math.max(nw, ne, sw, se) - lo, top: lo };
	}

	/** Footprint cells for an item rooted at (lx,lz) under a 90°·rotIdx rotation. */
	function footprint(lx, lz, nx, nz, rotIdx) {
		/** @type {Array<[number, number]>} */
		const cells = [];
		for (let ix = 0; ix < nx; ix++) {
			for (let iz = 0; iz < nz; iz++) {
				let dx, dz;
				switch (rotIdx) {
					case 1: dx = iz; dz = -ix; break;
					case 2: dx = -ix; dz = -iz; break;
					case 3: dx = -iz; dz = ix; break;
					default: dx = ix; dz = iz; break;
				}
				cells.push([lx + dx, lz + dz]);
			}
		}
		return cells;
	}

	/** @param {import("../three/structures.js").StructureItem} item @returns {boolean} */
	function tryPlace(item) {
		const lx = Math.floor(rng() * cs);
		const lz = Math.floor(rng() * cs);
		const wx = (cx * cs + lx) * 3;
		const wz = (cz * cs + lz) * 3;

		if (item.nx === 1 && item.nz === 1) {
			const key = `${lx},${lz}`;
			if (claimed.has(key)) return false;
			const c = cellInfo(lx, lz);
			if (c.span >= 3) return false;
			claimed.add(key);
			placements.push({ item, x: wx, z: wz, y: c.top, rotY: Math.floor(rng() * 4) * HALF_PI });
			return true;
		}

		const start = Math.floor(rng() * 4);
		for (let d = 0; d < 4; d++) {
			const rotIdx = (start + d) % 4;
			const cells = footprint(lx, lz, item.nx, item.nz, rotIdx);
			if (cells.some(([a, b]) => a < 0 || b < 0 || a >= cs || b >= cs)) continue;
			if (cells.some(([a, b]) => claimed.has(`${a},${b}`))) continue;
			const infos = cells.map(([a, b]) => cellInfo(a, b));
			if (infos.some((i) => i.span >= 3)) continue;
			const tops = infos.map((i) => i.top);
			if (Math.max(...tops) - Math.min(...tops) > 1) continue;
			cells.forEach(([a, b]) => claimed.add(`${a},${b}`));
			placements.push({ item, x: wx, z: wz, y: Math.min(...tops), rotY: rotIdx * HALF_PI });
			return true;
		}
		return false;
	}

	// Biome structures — budget scaled by biome-ness (additive, capped).
	if (pool.length > 0) {
		const budget = Math.min(maxStructures, Math.round(maxStructures * (biome.tire + biome.rust)));
		for (let i = 0; i < budget; i++) tryPlace(pool[Math.floor(rng() * pool.length)]);
	}

	// Global structures — uncommon, odds-gated (crane also chunk-modulo gated).
	for (const item of structures.global) {
		if (item.mod && (pmod(cx, item.mod) !== 0 || pmod(cz, item.mod) !== 0)) continue;
		const odds = item.odds != null ? item.odds : globalOdds;
		if (rng() * 100 < odds) tryPlace(item);
	}

	return placements;
}
