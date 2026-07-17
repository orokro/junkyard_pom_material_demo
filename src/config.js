/**
 * ============================================================================
 * config.js
 * ----------------------------------------------------------------------------
 * Single source of truth for all tunable parameters.
 *
 * Parameters are declared once as grouped field descriptors. The start-screen
 * form (src/ui/startScreen.js) and the Tweakpane runtime sidebar
 * (src/ui/sidebar.js) are both generated from these descriptors, so adding a
 * knob in one place surfaces it in the UI automatically.
 *
 * WORLD fields require regeneration when changed (they define the map).
 * RUNTIME fields are safe to tweak live (camera + shader + view options).
 * ============================================================================
 */

/**
 * @typedef {object} FieldDef
 * @property {string} key      Config property name.
 * @property {"number"|"text"|"bool"} type Field kind.
 * @property {string} label    Human label for the UI.
 * @property {*} value         Default value.
 * @property {number} [min]    Min (number fields).
 * @property {number} [max]    Max (number fields).
 * @property {number} [step]   Step (number fields).
 * @property {string} [hint]   Optional helper text.
 */

/**
 * @typedef {object} GroupDef
 * @property {string} title    Group heading.
 * @property {FieldDef[]} fields Fields in the group.
 */

/** @type {GroupDef[]} World-generation parameters (set on the start screen). */
export const WORLD_GROUPS = [
	{
		title: "Seed",
		fields: [
			{ key: "seed", type: "text", label: "Seed", value: "", hint: "Same seed → same map. Roll for a new one." },
		],
	},
	{
		title: "Terrain",
		fields: [
			{ key: "maxHeightMeters", type: "number", label: "Max height (m)", value: 30, min: 3, max: 600, step: 1, hint: "Ceiling the eastward ramp builds toward." },
			{ key: "chunkSize", type: "number", label: "Chunk size (cols)", value: 10, min: 4, max: 32, step: 1, hint: "Columns per chunk edge (× 3 m)." },
			{ key: "renderDistance", type: "number", label: "Render distance (chunks)", value: 12, min: 1, max: 20, step: 1 },
		],
	},
	{
		title: "Noise",
		fields: [
			{ key: "noiseScale", type: "number", label: "Scale (m/feature)", value: 60, min: 8, max: 600, step: 1, hint: "Larger = broader mounds." },
			{ key: "noiseOctaves", type: "number", label: "Octaves", value: 4, min: 1, max: 8, step: 1 },
			{ key: "noiseLacunarity", type: "number", label: "Lacunarity", value: 2.0, min: 1.5, max: 3.5, step: 0.1 },
			{ key: "noisePersistence", type: "number", label: "Persistence", value: 0.5, min: 0.1, max: 0.9, step: 0.05 },
			{ key: "noiseAmplitude", type: "number", label: "Amplitude", value: 1.0, min: 0.1, max: 1.5, step: 0.05 },
		],
	},
	{
		title: "Eastward gradient",
		fields: [
			{ key: "gradientEnabled", type: "bool", label: "Enabled", value: true },
			{ key: "gradientStart", type: "number", label: "Start (west)", value: 0.02, min: 0, max: 1, step: 0.01, hint: "Height multiplier at the western edge." },
			{ key: "gradientEnd", type: "number", label: "End (east)", value: 1.0, min: 0, max: 1, step: 0.01 },
			{ key: "gradientWidthMeters", type: "number", label: "Width W→E (m)", value: 200, min: 20, max: 2000, step: 10 },
		],
	},
	{
		title: "Paths",
		fields: [
			{ key: "pathsEnabled", type: "bool", label: "Enabled", value: true },
			{ key: "numPaths", type: "number", label: "Path count", value: 6, min: 0, max: 30, step: 1 },
			{ key: "pathMinSegments", type: "number", label: "Min segments", value: 5, min: 1, max: 40, step: 1 },
			{ key: "pathMaxSegments", type: "number", label: "Max segments", value: 12, min: 1, max: 60, step: 1 },
			{ key: "pathSegmentStepX", type: "number", label: "Step X (frac)", value: 0.1, min: 0.02, max: 0.5, step: 0.01, hint: "Eastward step per segment, fraction of path field." },
			{ key: "pathSegmentRangeZ", type: "number", label: "Range Z (± frac)", value: 0.2, min: 0.0, max: 0.5, step: 0.01 },
			{ key: "pathWorldSizeMeters", type: "number", label: "Field size (m)", value: 400, min: 50, max: 2000, step: 10, hint: "Square field from the western edge, centered on Z." },
			{ key: "pathThickness", type: "number", label: "Thickness (m)", value: 9, min: 1, max: 40, step: 1 },
			{ key: "pathBlur", type: "number", label: "Edge blur (m)", value: 6, min: 0, max: 40, step: 1, hint: "0 = sheer cliffs; higher = ramped shoulders." },
		],
	},
	{
		title: "Biomes",
		fields: [
			{ key: "biomesEnabled", type: "bool", label: "Enabled", value: true },
			{ key: "biomeScale", type: "number", label: "Region size (m)", value: 350, min: 60, max: 1500, step: 10, hint: "Size of biome blobs; bigger = broader regions." },
			{ key: "rustThreshold", type: "number", label: "Rust cutoff", value: 0.5, min: 0, max: 0.95, step: 0.01 },
			{ key: "tireThreshold", type: "number", label: "Tire cutoff", value: 0.5, min: 0, max: 0.95, step: 0.01 },
			{ key: "pitsThreshold", type: "number", label: "Pits cutoff", value: 0.58, min: 0, max: 0.95, step: 0.01 },
			{ key: "pathThreshold", type: "number", label: "Path-biome cutoff", value: 0.3, min: 0, max: 0.95, step: 0.01 },
			{ key: "pitsHoleScale", type: "number", label: "Pit hole size (m)", value: 20, min: 20, max: 400, step: 5 },
			{ key: "pitsDepth", type: "number", label: "Pit density (0-1)", value: 0.9, min: 0, max: 1, step: 0.05, hint: "Higher = more/denser pit pockets (capped so it never flattens the whole region)." },
			{ key: "pathCellScale", type: "number", label: "Path cell size (m)", value: 170, min: 30, max: 600, step: 5 },
			{ key: "pathWidth", type: "number", label: "Path lane width", value: 0.25, min: 0.02, max: 0.6, step: 0.01 },
		],
	},
	{
		title: "Structures",
		fields: [
			{ key: "structuresEnabled", type: "bool", label: "Enabled", value: true },
			{ key: "maxStructuresPerChunk", type: "number", label: "Max per chunk", value: 8, min: 0, max: 40, step: 1, hint: "Scaled down by how much biome a chunk has." },
			{ key: "globalOdds", type: "number", label: "Global odds % (default)", value: 8, min: 0, max: 100, step: 1, hint: "Spawn chance for un-tagged global items." },
		],
	},
];

/** @type {GroupDef[]} Runtime parameters (live in the sidebar). */
export const RUNTIME_GROUPS = [
	{
		title: "POM shader",
		fields: [
			{ key: "pomStrength", type: "number", label: "Parallax strength", value: 0.115, min: 0, max: 0.3, step: 0.005 },
			{ key: "pomSteps", type: "number", label: "Ray steps", value: 30, min: 4, max: 64, step: 1 },
			{ key: "pomInvertDepth", type: "bool", label: "Invert depth", value: false, hint: "Toggle if the surface pushes the wrong way." },
			{ key: "rustTint", type: "number", label: "Rust tint", value: 1.0, min: 0, max: 1, step: 0.05, hint: "Orange tint strength in rust biome." },
			{ key: "tireDesat", type: "number", label: "Tire desaturate", value: 1.0, min: 0, max: 1, step: 0.05, hint: "Desaturation strength in tire biome." },
		],
	},
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
			{ key: "floorTileMeters", type: "number", label: "Dirt tile (m)", value: 8, min: 1, max: 64, step: 1, hint: "World size of one dirt repeat; scrolls to stay world-locked." },
		],
	},
	{
		title: "View",
		fields: [
			{ key: "debugFlat", type: "bool", label: "Flat-shade (debug)", value: false, hint: "Neutral lit material instead of POM — see the raw geometry." },
			{ key: "debugWireframe", type: "bool", label: "Wireframe (debug)", value: false },
			{ key: "cullInteriorFaces", type: "bool", label: "Cull interior faces", value: false, hint: "Stretch-goal optimization; off for now." },
		],
	},
];

/**
 * Flatten grouped descriptors into a plain defaults object.
 * @param {GroupDef[]} groups Group descriptors.
 * @returns {Record<string, *>} Key → default value map.
 */
export function defaultsFrom(groups) {
	/** @type {Record<string, *>} */
	const out = {};
	for (const group of groups) {
		for (const field of group.fields) {
			out[field.key] = field.value;
		}
	}
	return out;
}

/** @returns {Record<string, *>} A fresh world-config object with defaults. */
export function makeWorldConfig() {
	return defaultsFrom(WORLD_GROUPS);
}

/** @returns {Record<string, *>} A fresh runtime-config object with defaults. */
export function makeRuntimeConfig() {
	return defaultsFrom(RUNTIME_GROUPS);
}
