/**
 * ============================================================================
 * main.js
 * ----------------------------------------------------------------------------
 * Application entry point. Wires the start screen, HUD, and Tweakpane sidebar
 * together and manages the top-level view state (setup ⇄ running).
 *
 * Phase 1 scope: UI skeleton only. No ThreeJS yet — "Start" reveals the
 * sky-blue viewport placeholder, HUD, and live sidebar. The assembled world
 * config is logged and stashed on window.__jyWorld for inspection; later
 * phases hand it to the generator.
 * ============================================================================
 */

import "./styles.css";
import { renderStartScreen } from "./ui/startScreen.js";
import { mountSidebar } from "./ui/sidebar.js";
import { renderHud } from "./ui/hud.js";
import { makeRuntimeConfig } from "./config.js";

const startScreenEl = /** @type {HTMLElement} */ (document.getElementById("start-screen"));
const sidebarEl = /** @type {HTMLElement} */ (document.getElementById("sidebar"));
const hudEl = /** @type {HTMLElement} */ (document.getElementById("hud"));

/** @type {{ dispose: () => void }|null} */
let sidebarHandle = null;

/** Runtime config persists across setup ⇄ running so live tweaks are retained. */
const runtimeConfig = makeRuntimeConfig();

/**
 * Show the setup (start-screen) view, tearing down the running view.
 * @returns {void}
 */
function showSetup() {
	sidebarHandle?.dispose();
	sidebarHandle = null;
	sidebarEl.classList.add("hidden");
	hudEl.classList.add("hidden");
	startScreenEl.classList.remove("hidden");
	renderStartScreen(startScreenEl, startRun);
}

/**
 * Enter the running view with an assembled world config.
 * @param {Record<string, *>} worldConfig World-generation parameters.
 * @returns {void}
 */
function startRun(worldConfig) {
	// Stash for inspection / handoff to the generator in a later phase.
	window.__jyWorld = worldConfig;
	console.info("[jy] world config:", worldConfig);
	console.info("[jy] runtime config:", runtimeConfig);

	startScreenEl.classList.add("hidden");
	sidebarEl.classList.remove("hidden");
	hudEl.classList.remove("hidden");

	renderHud(hudEl, String(worldConfig.seed));

	sidebarHandle = mountSidebar(sidebarEl, runtimeConfig, {
		onChange(key, value) {
			// Later phases route this into the camera / POM material.
			console.debug(`[jy] runtime ${key} = ${value}`);
		},
		onReturnHome() {
			// No camera yet — placeholder for the fly-cam reset.
			console.info("[jy] return home (no-op until camera exists)");
		},
		onBackToSetup() {
			showSetup();
		},
	});
}

showSetup();
