/**
 * ============================================================================
 * craft/theme.js
 * ----------------------------------------------------------------------------
 * CSS-chrome theming (locked: swatch-based, no hue-shift, 3D untouched).
 * A theme is a flat set of color swatches applied as CSS custom properties on
 * :root. Add themes to THEMES; the debug panel edits the active swatches live.
 * ============================================================================
 */

/** @typedef {Record<string,string>} Swatches */

/** @type {Record<string, Swatches>} */
export const THEMES = {
	orange: {
		"--frame": "#ef7d1e",
		"--bg": "#4b5763",
		"--panel": "#3b4653",
		"--panel-2": "#333d49",
		"--slot": "#2b3540",
		"--slot-edge": "#20272f",
		"--ink": "#0c0f13",
		"--text": "#f4f7fb",
		"--muted": "#c6d0db",
		"--accent": "#ef7d1e",
		"--good": "#7ad06a",
		"--arrow": "#5aa0e8",
	},
	viper: {
		"--frame": "#c3f53a",
		"--bg": "#585470",
		"--panel": "#494560",
		"--panel-2": "#3f3b54",
		"--slot": "#37324c",
		"--slot-edge": "#2a2740",
		"--ink": "#0c0f13",
		"--text": "#f4f7fb",
		"--muted": "#d0cade",
		"--accent": "#c3f53a",
		"--good": "#8ce06a",
		"--arrow": "#8a63e0",
	},
};

let active = "orange";
/** @type {Swatches} */
let current = { ...THEMES.orange };

/** Apply a swatch set to :root. @param {Swatches} sw */
function paint(sw) { for (const [k, v] of Object.entries(sw)) document.documentElement.style.setProperty(k, v); }

/** Switch to a named theme. */
export function setTheme(name) { if (!THEMES[name]) return; active = name; current = { ...THEMES[name] }; paint(current); }

/** Set one swatch (debug). */
export function setSwatch(key, value) { current[key] = value; document.documentElement.style.setProperty(key, value); }

export function getTheme() { return active; }
export function getSwatches() { return { ...current }; }
export function themeNames() { return Object.keys(THEMES); }

/** Initialize with the default theme. */
export function initTheme() { setTheme(active); }
