/**
 * ============================================================================
 * arena/config.js
 * ----------------------------------------------------------------------------
 * Single source of truth for the Arena POC's tunable parameters.
 *
 * Declared once as grouped field descriptors; the start-screen form
 * (arena/ui/startScreen.js) and the Tweakpane runtime sidebar
 * (arena/ui/sidebar.js) are both generated from these, so adding a knob in one
 * place surfaces it in the UI automatically.
 *
 * WORLD fields describe the arena and (later) require regeneration when changed.
 * RUNTIME fields are safe to tweak live (camera + view + floor).
 *
 * This is deliberately a sibling of the junkyard's config.js — the Arena POC
 * owns its own schema and shares no code with the junkyard.
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
			{ key: "seed", type: "text", label: "Seed", value: "", hint: "Same seed → same arena. Roll for a new one." },
		],
	},
	{
		title: "Arena",
		fields: [
			{
				key: "arenaSizeMeters",
				type: "number",
				label: "Arena size (diagonal m)",
				value: 60,
				min: 10,
				max: 400,
				step: 1,
				hint: "Diagonal in meters, like a TV size — the aspect ratio can vary, but this diameter sets the scale.",
			},
		],
	},
];

/** @type {GroupDef[]} Runtime parameters (live in the sidebar). */
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
			{ key: "floorTileMeters", type: "number", label: "Floor tile (m)", value: 8, min: 1, max: 64, step: 1, hint: "World size of one arena-floor repeat; scrolls to stay world-locked." },
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
