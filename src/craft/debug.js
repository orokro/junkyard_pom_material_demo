/**
 * ============================================================================
 * craft/debug.js
 * ----------------------------------------------------------------------------
 * Hidden debug panel (toggled by the chrome-less button at the far-left of the
 * bottom bar). Live controls for theme swatches, base-font override, inventory
 * tile size, and layout guides. Expand as the build grows.
 * ============================================================================
 */

import { THEMES, setTheme, setSwatch, getSwatches, themeNames, getTheme } from "./theme.js";
import { setScaleOverride, applyScale } from "./scale.js";
import { PLACE, firePlaceChange } from "./placement.js";

const SWATCH_KEYS = ["--frame", "--bg", "--panel", "--panel-2", "--slot", "--accent", "--arrow", "--text"];

/**
 * @param {HTMLElement} hitBtn the invisible toggle button
 * @returns {void}
 */
export function initDebug(hitBtn) {
	const el = document.createElement("div");
	el.id = "debug";
	el.className = "hidden";
	document.body.appendChild(el);

	function render() {
		el.innerHTML = "<h3>Debug</h3>";
		// theme
		const t = row("Theme");
		const sel = document.createElement("select");
		for (const n of themeNames()) { const o = document.createElement("option"); o.value = n; o.textContent = n; if (n === getTheme()) o.selected = true; sel.appendChild(o); }
		sel.onchange = () => { setTheme(sel.value); render(); };
		t.appendChild(sel); el.appendChild(t);

		// base font
		const autoR = row("Base font: auto");
		const auto = check(true); autoR.appendChild(auto); el.appendChild(autoR);
		const bfR = row("Base font px");
		const bf = range(3, 24, 0.5, parseFloat(getComputedStyle(document.documentElement).fontSize));
		bf.disabled = true;
		bf.oninput = () => setScaleOverride(parseFloat(bf.value));
		auto.onchange = () => { bf.disabled = auto.checked; if (auto.checked) { setScaleOverride(null); bf.value = parseFloat(getComputedStyle(document.documentElement).fontSize); } };
		bfR.appendChild(bf); el.appendChild(bfR);

		// tile size
		const tsR = row("Inv tile (rem)");
		const cur = parseFloat(getComputedStyle(document.documentElement).getPropertyValue("--tile")) || 5;
		const ts = range(2.5, 9, 0.25, cur);
		ts.oninput = () => document.documentElement.style.setProperty("--tile", ts.value + "rem");
		tsR.appendChild(ts); el.appendChild(tsR);

		// swatches
		const sw = getSwatches();
		for (const k of SWATCH_KEYS) {
			const r = row(k);
			const c = document.createElement("input"); c.type = "color"; c.value = toHex(sw[k]);
			c.oninput = () => setSwatch(k, c.value);
			r.appendChild(c); el.appendChild(r);
		}

		// placement family scales (base + attached hand scale together on the car)
		for (const fam of ["pipe", "spring", "ram"]) {
			const r = row("Scale: " + fam);
			const sl = range(0.3, 1.5, 0.05, PLACE[fam]);
			const val = document.createElement("b"); val.textContent = PLACE[fam].toFixed(2); val.style.marginLeft = "0.3rem";
			sl.oninput = () => { PLACE[fam] = parseFloat(sl.value); val.textContent = PLACE[fam].toFixed(2); firePlaceChange(); };
			r.appendChild(sl); r.appendChild(val); el.appendChild(r);
		}

		// jump-profile debug viz (corner markers, panto-free bbox, corner trails)
		const jdR = row("Jump debug viz");
		const jd = check(false); jd.onchange = () => window.__cv?.effects?.setDebug?.(jd.checked);
		jdR.appendChild(jd); el.appendChild(jdR);

		// guides
		const gR = row("Layout guides");
		const g = check(false); g.onchange = () => document.body.classList.toggle("guides", g.checked);
		gR.appendChild(g); el.appendChild(gR);
	}

	hitBtn.addEventListener("click", () => { el.classList.toggle("hidden"); if (!el.classList.contains("hidden")) render(); });
	window.addEventListener("keydown", (e) => { if (e.key === "`") { el.classList.toggle("hidden"); if (!el.classList.contains("hidden")) render(); } });
}

function row(label) { const d = document.createElement("label"); const s = document.createElement("span"); s.textContent = label; d.appendChild(s); return d; }
function range(min, max, step, val) { const i = document.createElement("input"); i.type = "range"; i.min = min; i.max = max; i.step = step; i.value = val; return i; }
function check(on) { const i = document.createElement("input"); i.type = "checkbox"; i.checked = on; return i; }
function toHex(c) { if (/^#([0-9a-f]{6})$/i.test(c || "")) return c; return "#888888"; }
