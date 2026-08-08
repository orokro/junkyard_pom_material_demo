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
	try {
		const thumbs = await initThumbs();
		window.__b = initBuilder(thumbs);
		console.info("[craft] builder ready");
	} catch (e) {
		console.error("[craft] init failed:", e);
	}
})();
