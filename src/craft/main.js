/**
 * ============================================================================
 * craft/main.js
 * ----------------------------------------------------------------------------
 * Crafting POC entry point: builds the scene, loads the parts library, wires the
 * garage + UI, and routes canvas clicks into placement/socket/wheel picking.
 * ============================================================================
 */

import "./styles.css";
import { createScene } from "./three/scene.js";
import { loadCraftLibrary } from "./three/library.js";
import { createGarage } from "./three/garage.js";
import { initUI } from "./ui.js";

const canvas = /** @type {HTMLCanvasElement} */ (document.getElementById("viewport"));

/** @param {string} t @returns {void} */
function setLoading(t) {
	let el = document.getElementById("loading");
	if (!el) { el = document.createElement("div"); el.id = "loading"; document.getElementById("app").appendChild(el); }
	el.textContent = t;
}
function clearLoading() { document.getElementById("loading")?.remove(); }

setLoading("Loading parts…");

const scene = createScene(canvas);
const els = {
	left: document.getElementById("left"),
	right: document.getElementById("right"),
	hint: document.getElementById("hint"),
};

(async () => {
try {
	const lib = await loadCraftLibrary(scene.renderer);
	const garage = createGarage(scene, lib);
	const ui = initUI(garage, els);
	garage.setOnChange(() => ui.refresh());

	// Optional HDR reflections (project skybox); harmless if absent.
	scene.applyHDR(new URL("../../assets/skybox/moonless_golf_4k.hdr", import.meta.url).href);
	scene.start();
	clearLoading();

	// Click-to-place / pick. Only acts while an item is pending (orbit otherwise).
	canvas.addEventListener("pointerup", (e) => {
		if (!garage.isPending()) return;
		const r = canvas.getBoundingClientRect();
		const ndc = { x: ((e.clientX - r.left) / r.width) * 2 - 1, y: -((e.clientY - r.top) / r.height) * 2 + 1 };
		const it = garage.pendingItem();
		const res = garage.click(ndc);
		if (res && it) ui.consumePending(it);
		if (res) ui.hint("");
	});
	window.addEventListener("keydown", (e) => { if (e.key === "Escape") { garage.cancel(); ui.hint(""); } });
} catch (err) {
	console.error("[craft] failed to start:", err);
	setLoading("Failed to load — see console.");
}
})();
