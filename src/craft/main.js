/**
 * ============================================================================
 * craft/main.js — Step 1 bootstrap (responsive REM shell)
 * ----------------------------------------------------------------------------
 * Wires the scaling engine, theme, and debug panel, and populates the panels
 * with placeholder content (real item list from data.js; 3D tiles come in the
 * ortho-overlay step). Use this to validate scale + reflow across resolutions.
 * ============================================================================
 */

import "./styles.css";
import { installScale } from "./scale.js";
import { initTheme } from "./theme.js";
import { initDebug } from "./debug.js";
import { ITEMS, BY_ID } from "./data.js";

/** Placeholder swatch color per category (until 3D thumbnails land). */
const CATCOLOR = { raw: "#7a8595", part: "#9aa6b6", wheel: "#3b3b3b", battery: "#caa63a", hand: "#c65ac6", weapon: "#d0663a" };

initTheme();

// ---- inventory (repeat the catalog a few times to exercise scroll/reflow) ----
const invgrid = document.getElementById("invgrid");
const stock = [];
for (let r = 0; r < 4; r++) for (const it of ITEMS) stock.push(it);
for (const it of stock) {
	const tile = document.createElement("div");
	tile.className = "invtile";
	tile.title = it.label;
	tile.innerHTML = `<div class="ph" style="background:${CATCOLOR[it.cat] || "#888"}"></div><span class="cnt">200</span>`;
	invgrid.appendChild(tile);
}

// ---- slots ----
const SLOTS = [
	{ key: "rear", label: "Rear", cols: 1, cells: 1 },
	{ key: "front", label: "Front", cols: 1, cells: 1 },
	{ key: "batteries", label: "Batteries", cols: 1, cells: 1, counter: "x2" },
	{ key: "tires", label: "Tires", cols: 2, cells: 4 },
	{ key: "suspension", label: "Suspension", cols: 2, cells: 4 },
];
const slotsrow = document.getElementById("slotsrow");
for (const g of SLOTS) {
	const grp = document.createElement("div"); grp.className = "slotgroup"; grp.dataset.cols = g.cols;
	const cells = document.createElement("div"); cells.className = "slotcells";
	for (let i = 0; i < g.cells; i++) {
		const c = document.createElement("div"); c.className = "cell";
		if (g.counter && i === 0) c.innerHTML = `<span class="cnt">${g.counter}</span>`;
		cells.appendChild(c);
	}
	const lab = document.createElement("div"); lab.className = "slotlabel"; lab.textContent = g.label;
	grp.appendChild(cells); grp.appendChild(lab); slotsrow.appendChild(grp);
}

// ---- crafting grid + output ----
const cgrid = document.getElementById("cgrid");
for (let i = 0; i < 9; i++) { const c = document.createElement("div"); c.className = "cell"; cgrid.appendChild(c); }

// ---- header measurement (feeds each body's clip-path notch) ----
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

// ---- scale + debug ----
installScale(measureHeaders);   // re-measure whenever the base font changes
measureHeaders();
if (document.fonts && document.fonts.ready) document.fonts.ready.then(measureHeaders); // re-measure once the real font loads
initDebug(document.getElementById("debughit"));

console.info("[craft] shell ready — resize the window / open debug (` or the far-left corner of the bottom bar).");
