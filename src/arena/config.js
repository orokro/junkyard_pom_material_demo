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
			{ key: "chairMaxPerTop", type: "number", label: "Max chairs / top", value: 2, min: 1, max: 5, step: 1, hint: "Upper bound on chairs placed on a single container top." },
			{ key: "occluderStory3Chance", type: "number", label: "3rd-ring extra story", value: 0.4, min: 0, max: 1, step: 0.05, hint: "Chance a back-ring occluder gets a 3rd story (verticality)." },
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
	{
		title: "Topology",
		fields: [
			{ key: "minPlatformCells", type: "number", label: "Min platform cells", value: 3, min: 1, max: 8, step: 1, hint: "Smallest raised platform a ramp may lead to; smaller islands are dropped (bridges exempt)." },
			{ key: "loops", type: "bool", label: "Loop ramps", value: true, hint: "Give raised islands a second ramp where possible, so you can loop instead of reversing." },
			{ key: "bowl", type: "bool", label: "Bowl layout", value: false, hint: "Push tall structures (L3) to the walls and L2 to a mid ring, keeping the centre open — a bowl. Off = structures anywhere." },
		],
	},
	{
		title: "Decor & lights",
		fields: [
			{ key: "tentChance", type: "number", label: "Tent chance / cell", value: 0.3, min: 0, max: 1, step: 0.05, hint: "Chance each outer-wall top cell gets an EZ-up tent (up to 2 per container)." },
			{ key: "stadiumLights", type: "number", label: "Stadium lights", value: 10, min: 0, max: 40, step: 1, hint: "Number of stadium light towers spaced around the arena, facing in." },
			{ key: "stadiumLightScale", type: "number", label: "Light scale", value: 1, min: 0.3, max: 3, step: 0.1, hint: "Size multiplier for the stadium light towers." },
			{ key: "stadiumLightMargin", type: "number", label: "Light distance (m)", value: 18, min: 0, max: 60, step: 1, hint: "How far outside the walls the light towers stand." },
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
		title: "Lighting (HDR)",
		fields: [
			{ key: "exposure", type: "number", label: "Exposure", value: 1.1, min: 0.1, max: 4, step: 0.05, hint: "Tone-mapping exposure." },
			{ key: "envIntensity", type: "number", label: "Env intensity", value: 1.4, min: 0, max: 5, step: 0.05, hint: "Strength of HDR image-based lighting on materials." },
			{ key: "bgIntensity", type: "number", label: "Sky brightness", value: 1.0, min: 0, max: 4, step: 0.05, hint: "Brightness of the HDR sky background." },
			{ key: "hemiIntensity", type: "number", label: "Fill light", value: 0.12, min: 0, max: 2, step: 0.02, hint: "Analytic hemisphere fill on top of the HDR." },
			{ key: "sunIntensity", type: "number", label: "Moonlight", value: 0.5, min: 0, max: 4, step: 0.05, hint: "Directional key light (moon)." },
			{ key: "showBackground", type: "bool", label: "Show sky", value: true, hint: "Toggle the HDR sky background." },
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
