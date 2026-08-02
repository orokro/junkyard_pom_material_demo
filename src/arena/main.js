/**
 * ============================================================================
 * arena/main.js
 * ----------------------------------------------------------------------------
 * Arena POC entry point. Wires the start screen, HUD, Tweakpane sidebar, and
 * the ThreeJS arena demo together, managing the top-level view state
 * (setup ⇄ running).
 *
 * Independent of the junkyard POC: everything it imports lives under src/arena/.
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
function setLoading(on, text = "Preparing arena…") {
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
	window.__arenaWorld = worldConfig;
	console.info("[arena] world config:", worldConfig);

	startScreenEl.classList.add("hidden");
	setLoading(true);

	try {
		demo = await startDemo(canvasEl, runtimeConfig, worldConfig, {
			onProgress: (loaded, total) => setLoading(true, `Preparing arena… ${loaded}/${total}`),
			onStats: (s) => updateHudStats(`${s.walking ? "walk" : "fly"} · x ${s.x.toFixed(0)} z ${s.z.toFixed(0)}`),
		});
	} catch (err) {
		console.error("[arena] demo failed to start:", err);
		setLoading(true, "Failed to start — see console.");
		return;
	}

	setLoading(false);
	sidebarEl.classList.remove("hidden");
	hudEl.classList.remove("hidden");

	const hint =
		"Click to look · WASD move · Shift boost · Tab walk/fly · Space/C fly up-down" +
		(demo.usingFallbackFloor ? " · placeholder floor (drop arena_floor_* into assets/tex)" : "");
	renderHud(hudEl, `${worldConfig.seed}  ·  arena ${worldConfig.arenaSizeMeters} m`, hint);

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
		onPostToggle(enabled) {
			demo?.setPostEnabled(enabled);
		},
		onApplyShader(code) {
			demo?.setPostShader(code);
		},
	});
}

showSetup();
