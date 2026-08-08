/**
 * ============================================================================
 * craft/theme.js
 * ----------------------------------------------------------------------------
 * CSS-chrome theming (locked: swatch-based, no hue-shift, 3D untouched).
 * A theme is a flat set of color swatches applied as CSS custom properties on
 * :root. Colors sampled from Greg's Photoshop mockups. Add themes to THEMES;
 * the debug panel edits the active swatches live.
 * ============================================================================
 */

/** @typedef {Record<string,string>} Swatches */

/** @type {Record<string, Swatches>} */
export const THEMES = {
	orange: {
		"--frame": "#ff741b",   // outer field, dividers, labels, accents
		"--panel": "#465b63",   // blue-grey panel fill
		"--panel-2": "#3c4f57", // darker inset / 3D view backdrop
		"--slot": "#2e3b40",    // cell fill
		"--slot-edge": "#26343a",
		"--ink": "#0c0c0c",     // black headers / icons / buttons
		"--text": "#f4f7fb",    // light values (counts, numbers)
		"--muted": "#cdd6de",
		"--accent": "#ff741b",
		"--good": "#7ad06a",
		"--arrow": "#5d93c0",
	},
	viper: {
		"--frame": "#ccff1b",
		"--panel": "#494663",
		"--panel-2": "#403d56",
		"--slot": "#302e40",
		"--slot-edge": "#282638",
		"--ink": "#0c0c0c",
		"--text": "#f4f7fb",
		"--muted": "#d3cee2",
		"--accent": "#ccff1b",
		"--good": "#8ce06a",
		"--arrow": "#795dc0",
	},
};

let active = "orange";
/** @type {Swatches} */
let current = { ...THEMES.orange };

function paint(sw) { for (const [k, v] of Object.entries(sw)) document.documentElement.style.setProperty(k, v); }

export function setTheme(name) { if (!THEMES[name]) return; active = name; current = { ...THEMES[name] }; paint(current); }
export function setSwatch(key, value) { current[key] = value; document.documentElement.style.setProperty(key, value); }
export function getTheme() { return active; }
export function getSwatches() { return { ...current }; }
export function themeNames() { return Object.keys(THEMES); }
export function initTheme() { setTheme(active); }
