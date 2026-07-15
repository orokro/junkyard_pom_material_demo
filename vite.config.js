/**
 * ============================================================================
 * vite.config.js
 * ----------------------------------------------------------------------------
 * Vite configuration for the junkyard POC.
 *
 * base: './' emits relative asset URLs so the static build in dist/ works from
 * any subpath (GitHub Pages project sites, a nested folder on a static host, or
 * a file:// preview) without rebuilding.
 *
 * The GLB + textures under assets/ are loaded from JS via
 * `new URL('../../assets/...', import.meta.url)` (added in the ThreeJS phase),
 * which Vite fingerprints and copies into dist/ automatically — so we do not
 * use publicDir and do not move Greg's asset folder.
 * ============================================================================
 */

import { defineConfig } from "vite";

export default defineConfig({
	base: "./",
	build: {
		outDir: "dist",
		assetsDir: "bundle",
		emptyOutDir: true,
	},
	server: {
		host: true,
	},
});
