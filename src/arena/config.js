/**
 * ============================================================================
 * arena/config.js
 * ----------------------------------------------------------------------------
 * Single source of truth for the Arena POC's tunable parameters. The start-
 * screen form (WORLD) and the Tweakpane sidebar (RUNTIME) are generated from
 * these descriptors.
 *
 * WORLD fields define the arena (require regeneration on change). RUNTIME fields
 * are live (camera / floor / debug view). Sibling of the junkyard config — the
 * arena owns its own schema.
 * ============================================================================
 */

/**
 * @typedef {object} FieldDef
 * @property {string} key
 * @property {"number"|"text"|"bool"} type
 * @property {string} label
 * @property {*} value
 * @property {number} [min] @property {number} [max] @property {number} [step]
 * @property {string} [hint]
 */
/** @typedef {{ title: string, fields: FieldDef[] }} GroupDef */

/** @type {GroupDef[]} World-generation parameters (start screen). */
export const WORLD_GROUPS = [
	{
		title: "Seed",
		fields: [{ key: "seed", type: "text", label: "Seed", value: "", hint: "Same seed → same arena. Roll for a new one." }],
	},
	{
		title: "Arena",
		fields: [
			{ key: "arenaSizeMeters", type: "number", label: "Arena size (diagonal m)", value: 60, min: 20, max: 400, step: 1, hint: "Diagonal in meters (TV-size analogy); aspect ratio varies." },
			{ key: "aspectMin", type: "number", label: "Aspect min (w/d)", value: 0.5, min: 0.25, max: 1, step: 0.05, hint: "Lower = allow taller (portrait) arenas." },
			{ key: "aspectMax", type: "number", label: "Aspect max (w/d)", value: 2.0, min: 1, max: 4, step: 0.05, hint: "Higher = allow wider (landscape) arenas." },
		],
	},
	{
		title: "Outer walls",
		fields: [
			{ key: "secondStoryChance", type: "number", label: "2nd-story chance", value: 0.5, min: 0, max: 1, step: 0.05, hint: "Fraction of ring containers that get a second story." },
			{ key: "maxInwardPokes", type: "number", label: "Max inward pokes", value: 4, min: 0, max: 16, step: 1, hint: "Containers poking into the arena to break the rectangle." },
			{ key: "chairChance", type: "number", label: "Chair chance / top", value: 0.55, min: 0, max: 1, step: 0.05, hint: "Chance an eligible ring-top spawns grandstand chairs." },
		],
	},
	{
		title: "Level 2 (raised platforms)",
		fields: [
			{ key: "level2CoverageMin", type: "number", label: "Coverage min", value: 0.08, min: 0, max: 0.6, step: 0.01, hint: "Min fraction of the arena raised to level 2." },
			{ key: "level2CoverageMax", type: "number", label: "Coverage max", value: 0.25, min: 0, max: 0.6, step: 0.01, hint: "Max fraction raised to level 2." },
			{ key: "maxIslandsL2", type: "number", label: "Max islands", value: 3, min: 1, max: 8, step: 1, hint: "Upper bound on distinct level-2 islands (each gets ≥1 ramp)." },
		],
	},
	{
		title: "Level 3 (container tops)",
		fields: [
			{ key: "level3CoverageMin", type: "number", label: "Coverage min", value: 0.05, min: 0, max: 0.5, step: 0.01, hint: "Min fraction of the arena raised to level 3 (container tops)." },
			{ key: "level3CoverageMax", type: "number", label: "Coverage max", value: 0.18, min: 0, max: 0.5, step: 0.01, hint: "Max fraction raised to level 3." },
			{ key: "maxIslandsL3", type: "number", label: "Max islands", value: 2, min: 1, max: 6, step: 1, hint: "Upper bound on distinct level-3 islands (each reached by a 2→3 ramp)." },
			{ key: "minBridges", type: "number", label: "Min bridges", value: 1, min: 0, max: 12, step: 1, hint: "Bridges are placed deliberately (drive over + under); this many are guaranteed if space allows." },
			{ key: "maxBridges", type: "number", label: "Max bridges", value: 3, min: 0, max: 12, step: 1, hint: "Upper bound on planned bridges per arena." },
		],
	},
];

/** @type {GroupDef[]} Runtime parameters (live sidebar). */
export const RUNTIME_GROUPS = [
	{
		title: "Camera",
		fields: [
			{ key: "walkSpeed", type: "number", label: "Walk speed (m/s)", value: 4, min: 1, max: 20, step: 0.5 },
			{ key: "cameraSpeed", type: "number", label: "Fly speed (m/s)", value: 18, min: 2, max: 120, step: 1 },
			{ key: "cameraFov", type: "number", label: "FOV", value: 70, min: 40, max: 100, step: 1 },
		],
	},
	{
		title: "Floor",
		fields: [
			{ key: "floorVisible", type: "bool", label: "Show floor", value: true },
			{ key: "floorTileMeters", type: "number", label: "Floor tile (m)", value: 8, min: 1, max: 64, step: 1 },
		],
	},
	{
		title: "Debug",
		fields: [{ key: "debugOverlay", type: "bool", label: "Top-down overlay", value: true, hint: "Schematic map of the generated arena." }],
	},
];

/**
 * @param {GroupDef[]} groups @returns {Record<string, *>}
 */
export function defaultsFrom(groups) {
	/** @type {Record<string, *>} */
	const out = {};
	for (const g of groups) for (const f of g.fields) out[f.key] = f.value;
	return out;
}

/** @returns {Record<string, *>} */
export function makeWorldConfig() {
	return defaultsFrom(WORLD_GROUPS);
}
/** @returns {Record<string, *>} */
export function makeRuntimeConfig() {
	return defaultsFrom(RUNTIME_GROUPS);
}
