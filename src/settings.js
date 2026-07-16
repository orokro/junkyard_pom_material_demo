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
