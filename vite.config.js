/**
 * ============================================================================
 * vite.config.js
 * ----------------------------------------------------------------------------
 * Vite configuration for the Dumper Cars POC hub (multi-page).
 *
 * base: './' emits relative asset URLs so the static build in dist/ works from
 * any subpath (GitHub Pages project sites, a nested folder on a static host, or
 * a file:// preview) without rebuilding.
 *
 * Multi-page: each POC is its own HTML entry document, listed in
 * build.rollupOptions.input so `vite build` emits all of them. This is what
 * makes routing refresh-safe — every POC is a real URL, so refreshing while on
 * one reloads that POC instead of the landing page.
 *
 *   index.html     → landing / picker (the default page at /)
 *   junkyard.html  → junkyard generation POC (unchanged entry, relocated here)
 *   arena.html     → arena generation POC
 *
 * The GLB + textures under assets/ are loaded from JS via import.meta.glob /
 * new URL(..., import.meta.url), which Vite fingerprints and copies into dist/
 * automatically — so we do not use publicDir and do not move Greg's asset folder.
 * ============================================================================
 */

import { defineConfig } from "vite";
import { fileURLToPath } from "node:url";

/**
 * Resolve a path relative to this config file to an absolute filesystem path.
 * @param {string} rel Relative path (e.g. "./index.html").
 * @returns {string} Absolute path.
 */
const abs = (rel) => fileURLToPath(new URL(rel, import.meta.url));

export default defineConfig({
	base: "./",
	build: {
		outDir: "dist",
		assetsDir: "bundle",
		emptyOutDir: true,
		rollupOptions: {
			input: {
				main: abs("./index.html"),
				junkyard: abs("./junkyard.html"),
				arena: abs("./arena.html"),
				craft: abs("./craft.html"),
			},
		},
	},
	server: {
		host: true,
	},
});
