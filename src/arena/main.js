/**
 * ============================================================================
 * arena/main.js
 * ----------------------------------------------------------------------------
 * Arena POC entry point: wires the start screen, HUD, Tweakpane sidebar, and the
 * ThreeJS arena demo, managing the setup ⇄ running view state. Independent of the
 * junkyard POC (everything imported lives under src/arena/).
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

const runtimeConfig = makeRuntimeConfig();

/**
 * @param {boolean} on @param {string} [text] @returns {void}
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

/** @returns {void} */
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
 * @param {Record<string, *>} worldConfig @returns {Promise<void>}
 */
async function startRun(worldConfig) {
	window.__arenaWorld = worldConfig;
	console.info("[arena] world config:", worldConfig);

	startScreenEl.classList.add("hidden");
	setLoading(true, "Generating arena…");

	try {
		demo = await startDemo(canvasEl, runtimeConfig, worldConfig, {
			onProgress: (loaded, total) => {
				const mb = total > 1 ? ` ${(loaded / 1e6).toFixed(0)}/${(total / 1e6).toFixed(0)} MB` : "";
				setLoading(true, `Loading arena parts…${mb}`);
			},
			onStats: (st) => updateHudStats(`${st.walking ? "walk" : "fly"} · x ${st.x.toFixed(0)} z ${st.z.toFixed(0)}`),
		});
	} catch (err) {
		console.error("[arena] demo failed to start:", err);
		setLoading(true, "Failed to start — see console.");
		return;
	}

	setLoading(false);
	sidebarEl.classList.remove("hidden");
	hudEl.classList.remove("hidden");

	const d = demo.model.dims;
	renderHud(
		hudEl,
		`${worldConfig.seed}  ·  ${d.Wc}×${d.Dc} cells (${worldConfig.arenaSizeMeters} m diag)`,
		"Click to look · WASD move · Shift boost · Tab walk/fly · Space/C fly up-down · overlay in sidebar"
	);

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
			return demo?.exportGLB();
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
