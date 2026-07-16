/**
 * ============================================================================
 * settings.js
 * ----------------------------------------------------------------------------
 * Persists the full world-generation config (all form values, including the
 * seed) to localStorage so a page refresh restores the last-used settings, not
 * just the seed.
 * ============================================================================
 */

const KEY = "jy_pom_demo.settings";
const POST_KEY = "jy_pom_demo.postfx";

/**
 * Load the saved world config.
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
 * Persist the world config.
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
 * Load persisted post-FX state.
 * @returns {{ enabled: boolean, code: string|null }} Saved state (defaults if none).
 */
export function loadPostFX() {
	try {
		const raw = localStorage.getItem(POST_KEY);
		if (!raw) return { enabled: false, code: null };
		const p = JSON.parse(raw);
		return { enabled: Boolean(p.enabled), code: typeof p.code === "string" ? p.code : null };
	} catch {
		return { enabled: false, code: null };
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
