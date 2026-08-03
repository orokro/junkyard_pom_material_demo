/**
 * ============================================================================
 * arena/settings.js
 * ----------------------------------------------------------------------------
 * Persists the Arena POC's world-generation config (all start-screen values,
 * including the seed) and the post-FX state to localStorage, so a refresh
 * restores the last-used setup.
 *
 * Keys are namespaced to the arena so they never collide with the junkyard
 * POC's saved settings.
 * ============================================================================
 */

const KEY = "arena_poc.settings";
const POST_KEY = "arena_poc.postfx";
const PRESETS_KEY = "arena_poc.presets";

/**
 * Load the saved arena config.
 * @returns {Record<string, *>|null} Saved config, or null if none/unavailable.
 */
export function loadSettings() {
	try {
		const raw = localStorage.getItem(KEY);
		return raw ? JSON.parse(raw) : null;
	} catch {
		return null;
	}
}

/**
 * Persist the arena config.
 * @param {Record<string, *>} config Assembled world config.
 * @returns {void}
 */
export function saveSettings(config) {
	try {
		localStorage.setItem(KEY, JSON.stringify(config));
	} catch {
		/* storage unavailable — non-fatal. */
	}
}

/**
 * @typedef {object} Preset
 * @property {string} name
 * @property {Record<string, *>} config  A full world config (seed + all settings).
 */

/**
 * Load the saved presets list.
 * @returns {Preset[]} Saved presets (empty array if none/unavailable).
 */
export function loadPresets() {
	try {
		const raw = localStorage.getItem(PRESETS_KEY);
		const list = raw ? JSON.parse(raw) : [];
		return Array.isArray(list) ? list.filter((p) => p && typeof p.name === "string" && p.config) : [];
	} catch {
		return [];
	}
}

/**
 * Persist the presets list.
 * @param {Preset[]} presets
 * @returns {void}
 */
export function savePresets(presets) {
	try {
		localStorage.setItem(PRESETS_KEY, JSON.stringify(presets));
	} catch {
		/* storage unavailable — non-fatal. */
	}
}

/**
 * Load persisted post-FX state.
 * @returns {{ enabled: boolean, code: string|null }} Saved state (defaults if none).
 */
export function loadPostFX() {
	try {
		const raw = localStorage.getItem(POST_KEY);
		if (!raw) return { enabled: true, code: null };
		const p = JSON.parse(raw);
		return { enabled: Boolean(p.enabled), code: typeof p.code === "string" ? p.code : null };
	} catch {
		return { enabled: true, code: null };
	}
}

/**
 * Persist post-FX state.
 * @param {{ enabled: boolean, code: string }} state
 * @returns {void}
 */
export function savePostFX(state) {
	try {
		localStorage.setItem(POST_KEY, JSON.stringify(state));
	} catch {
		/* storage unavailable — non-fatal. */
	}
}
