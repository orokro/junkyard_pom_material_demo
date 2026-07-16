/**
 * ============================================================================
 * main.js
 * ----------------------------------------------------------------------------
 * Application entry point. Wires the start screen, HUD, Tweakpane sidebar, and
 * (Phase 2) the ThreeJS POM-cube demo together, managing the top-level view
 * state (setup ⇄ running).
 * ============================================================================
 */

import "./styles.css";
import { renderStartScreen } from "./ui/startScreen.js";
import { mountSidebar } from "./ui/sidebar.js";
import { renderHud, updateHudStats } from "./ui/hud.js";
import { makeRuntimeConfig } from "./config.js";
import { startDemo } from "./three/demo.js";

const startScreenEl = /** @type {HTMLElement} */ (document.getElementById("start-screen"));
const sidebarEl = /** @type {HTMLElement} */ (document.getElementById("sidebar"));
const hudEl = /** @type {HTMLElement} */ (document.getElementById("hud"));
const canvasEl = /** @type {HTMLCanvasElement} */ (document.getElementById("viewport"));

/** @type {{ dispose: () => void }|null} */
let sidebarHandle = null;
/** @type {import("./three/demo.js").DemoApi|null} */
let demo = null;

/** Runtime config persists across setup ⇄ running so live tweaks are retained. */
const runtimeConfig = makeRuntimeConfig();

/**
 * Toggle a simple full-screen loading overlay.
 * @param {boolean} on Show/hide.
 * @param {string} [text] Message.
 * @returns {void}
 */
function setLoading(on, text = "Loading textures…") {
	let el = document.getElementById("loading");
	if (on) {
		if (!el) {
			el = document.createElement("div");
			el.id = "loading";
			el.style.cssText =
				"position:absolute;inset:0;display:grid;place-items:center;z-index:50;" +
				"background:rgba(10,13,18,0.72);color:#e7ecf3;font:600 14px Inter,system-ui,sans-serif;";
			document.getElementById("app")?.appendChild(el);
		}
		el.textContent = text;
	} else if (el) {
		el.remove();
	}
}

/**
 * Show the setup (start-screen) view, tearing down the running view.
 * @returns {void}
 */
function showSetup() {
	sidebarHandle?.dispose();
	sidebarHandle = null;
	demo?.dispose();
	demo = null;
	sidebarEl.classList.add("hidden");
	hudEl.classList.add("hidden");
	startScreenEl.classList.remove("hidden");
	renderStartScreen(startScreenEl, startRun);
}

/**
 * Enter the running view with an assembled world config.
 * @param {Record<string, *>} worldConfig World-generation parameters.
 * @returns {Promise<void>}
 */
async function startRun(worldConfig) {
	window.__jyWorld = worldConfig;
	console.info("[jy] world config:", worldConfig);

	startScreenEl.classList.add("hidden");
	setLoading(true);

	try {
		demo = await startDemo(canvasEl, runtimeConfig, worldConfig, {
			onProgress: (loaded, total) => setLoading(true, `Loading textures… ${loaded}/${total}`),
			onStats: (s) =>
				updateHudStats(
					`${s.walking ? "walk" : "fly"} · chunks: ${s.active}${s.pending ? ` (+${s.pending})` : ""} · x ${s.x.toFixed(0)} z ${s.z.toFixed(0)}`
				),
		});
	} catch (err) {
		console.error("[jy] demo failed to start:", err);
		setLoading(true, "Failed to start — see console.");
		return;
	}

	setLoading(false);
	sidebarEl.classList.remove("hidden");
	hudEl.classList.remove("hidden");
	renderHud(hudEl, String(worldConfig.seed), "Click to look · WASD move · Shift boost · Tab walk/fly · Space/C fly up-down");

	sidebarHandle = mountSidebar(sidebarEl, runtimeConfig, {
		onChange(key, value) {
			demo?.applyRuntime(key, value);
		},
		onReturnHome() {
			demo?.resetView();
		},
		onBackToSetup() {
			showSetup();
		},
		onExport() {
			demo?.exportGLB();
		},
	});
}

showSetup();
