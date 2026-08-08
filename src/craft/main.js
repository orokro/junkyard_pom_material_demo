/**
 * ============================================================================
 * craft/main.js — Crafting Bay bootstrap
 * ----------------------------------------------------------------------------
 * Wires scaling, theme, debug, the 3D thumbnail overlay, and the interactive
 * builder (inventory / crafting / slots + drag-and-drop).
 * ============================================================================
 */

import "./styles.css";
import { installScale } from "./scale.js";
import { initTheme } from "./theme.js";
import { initDebug } from "./debug.js";
import { initThumbs } from "./thumbs.js";
import { initCarView } from "./carview.js";
import { initBuilder } from "./builder.js";

initTheme();

/** Measure each header tab and expose its size (rem) to the body clip-path. */
function measureHeaders() {
	const rem = parseFloat(getComputedStyle(document.documentElement).fontSize) || 16;
	for (const p of document.querySelectorAll(".panel")) {
		const h = p.querySelector(".phead"), body = p.querySelector(".pbody");
		if (!h || !body) continue;
		body.style.setProperty("--hw", (h.offsetWidth / rem).toFixed(3) + "rem");
		body.style.setProperty("--hh", (h.offsetHeight / rem).toFixed(3) + "rem");
	}
}

installScale(measureHeaders);
measureHeaders();
if (document.fonts && document.fonts.ready) document.fonts.ready.then(measureHeaders);
initDebug(document.getElementById("debughit"));

(async () => {
	// The builder (drag/craft/slots) must work even if the 3D overlay can't start
	// (e.g. no WebGL) — so init thumbnails defensively and always init the builder.
	let thumbs, lib = null, carview = null;
	try { thumbs = await initThumbs(); lib = thumbs.lib; }
	catch (e) { console.error("[craft] thumbnails failed (continuing without 3D):", e); thumbs = { refresh() {}, cfg: {} }; }
	if (lib) { try { carview = initCarView(lib); } catch (e) { console.error("[craft] car view failed:", e); } }
	window.__b = initBuilder(thumbs, carview ? {
		onSlots: (slots) => carview.syncLoadout(slots),
		onHeld: (held) => carview.setHeld(held),
	} : null);
	if (carview) carview.setCallbacks({ onPlace: window.__b.onPlace, onDetach: window.__b.onDetach });
	window.__cv = carview;   // test hook
	window.__lib = lib;      // test hook
	console.info("[craft] builder ready");
})();
