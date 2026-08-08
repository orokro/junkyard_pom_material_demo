/**
 * ============================================================================
 * craft/ui.js
 * ----------------------------------------------------------------------------
 * DOM UI for the crafting POC: loadout/slots panel (left), inventory + shapeless
 * crafting bench (right), weight readout, and the action hint bar. Kept in plain
 * DOM synced to the 3D garage — no framework.
 * ============================================================================
 */

import { ITEMS, BY_ID, RECIPES } from "./data.js";

const CATS = [
	["raw", "Raw materials"], ["part", "Parts"], ["wheel", "Wheels"],
	["battery", "Battery"], ["hand", "Hands"], ["weapon", "Weapons"],
];

/**
 * @param {object} garage createGarage() API
 * @param {object} els { left, right, hint }
 * @returns {object} ui API
 */
export function initUI(garage, els) {
	/** starting stock — hundreds of everything for testing. */
	const inv = Object.fromEntries(ITEMS.map((i) => [i.id, 500]));
	/** crafting bench multiset. */
	const bench = {};

	// ---- layout scaffolding ----
	els.right.innerHTML = `
		<div class="tabs">
			<button data-tab="inv" class="tab active">Inventory</button>
			<button data-tab="craft" class="tab">Craft</button>
		</div>
		<div class="tabbody" id="tab-inv"></div>
		<div class="tabbody hidden" id="tab-craft"></div>`;
	els.right.querySelectorAll(".tab").forEach((b) => b.addEventListener("click", () => {
		els.right.querySelectorAll(".tab").forEach((x) => x.classList.toggle("active", x === b));
		els.right.querySelector("#tab-inv").classList.toggle("hidden", b.dataset.tab !== "inv");
		els.right.querySelector("#tab-craft").classList.toggle("hidden", b.dataset.tab !== "craft");
	}));

	const invBody = els.right.querySelector("#tab-inv");
	const craftBody = els.right.querySelector("#tab-craft");

	function hint(text, cancel) {
		els.hint.innerHTML = text ? `<span>${text}</span>` : "";
		if (cancel) { const b = document.createElement("button"); b.textContent = "Cancel"; b.className = "mini"; b.onclick = () => { garage.cancel(); hint(""); }; els.hint.appendChild(b); }
	}

	// ---- inventory ----
	function renderInv() {
		invBody.innerHTML = "";
		for (const [cat, label] of CATS) {
			const items = ITEMS.filter((i) => i.cat === cat);
			if (!items.length) continue;
			const h = document.createElement("div"); h.className = "grouphead"; h.textContent = label; invBody.appendChild(h);
			const grid = document.createElement("div"); grid.className = "grid";
			for (const it of items) {
				const b = document.createElement("button"); b.className = "chip";
				b.innerHTML = `<span class="chip__n">${it.label}</span><span class="chip__c">${inv[it.id]}</span>`;
				b.title = `${it.mount ? "mount: " + it.mount : "material"} · wt ${it.weight}`;
				b.onclick = () => selectItem(it);
				grid.appendChild(b);
			}
			invBody.appendChild(grid);
		}
	}

	function selectItem(it) {
		if (inv[it.id] <= 0) { hint(`Out of ${it.label}`); return; }
		const r = garage.begin(it);
		if (r === "attached") { inv[it.id]--; refresh(); hint(`${it.label} mounted.`); }
		else if (r === "place") hint(`Click the car's painted surface to place <b>${it.label}</b>.`, true);
		else if (r === "pick-wheel") hint(`Click a wheel to fit <b>${it.label}</b>.`, true);
		else if (r === "pick-socket") hint(`Click a green socket to attach the <b>${it.label}</b>.`, true);
	}

	/** called by main.js after a successful 3D click that consumed the pending item */
	function consumePending(it) { if (it && inv[it.id] > 0) inv[it.id]--; refresh(); }

	// ---- crafting bench (shapeless, many-to-many) ----
	function renderCraft() {
		craftBody.innerHTML = `<div class="benchwrap"><div class="benchhead">Bench <button class="mini" id="benchclear">Clear</button></div>
			<div class="bench" id="bench"></div><div class="outs" id="outs"></div></div>
			<div class="grouphead">Add to bench</div><div class="grid" id="palette"></div>`;
		const pal = craftBody.querySelector("#palette");
		for (const it of ITEMS) {
			const b = document.createElement("button"); b.className = "chip"; b.innerHTML = `<span class="chip__n">${it.label}</span>`;
			b.onclick = () => { if (inv[it.id] > 0) { bench[it.id] = (bench[it.id] || 0) + 1; renderBench(); } };
			pal.appendChild(b);
		}
		craftBody.querySelector("#benchclear").onclick = () => { for (const k of Object.keys(bench)) delete bench[k]; renderBench(); };
		renderBench();
	}

	function benchMatches() {
		const keys = Object.keys(bench).filter((k) => bench[k] > 0);
		return RECIPES.filter((r) => {
			const rk = Object.keys(r.in);
			if (rk.length !== keys.length) return false;
			return rk.every((k) => bench[k] === r.in[k]);
		});
	}

	function renderBench() {
		const b = craftBody.querySelector("#bench"); const o = craftBody.querySelector("#outs");
		b.innerHTML = ""; o.innerHTML = "";
		for (const [id, n] of Object.entries(bench)) {
			if (!n) continue;
			const chip = document.createElement("button"); chip.className = "chip small"; chip.innerHTML = `${BY_ID[id].label} ×${n}`;
			chip.onclick = () => { bench[id]--; if (bench[id] <= 0) delete bench[id]; renderBench(); };
			b.appendChild(chip);
		}
		const matches = benchMatches();
		const outSet = new Map();
		for (const r of matches) for (const out of r.out) outSet.set(out + "|" + JSON.stringify(r.in), { out, r });
		if (!outSet.size) { o.innerHTML = `<span class="muted">No recipe — try 1×Long Pipe, or 5×Short Pipe + 1×Rubber Hose.</span>`; return; }
		// group identical outputs within a recipe (e.g. 3× short pipe)
		for (const { out, r } of outSet.values()) {
			const btn = document.createElement("button"); btn.className = "outbtn";
			const count = r.out.filter((x) => x === out).length;
			btn.innerHTML = `Craft ${BY_ID[out].label}${count > 1 ? " ×" + count : ""}`;
			btn.onclick = () => {
				for (const [k, v] of Object.entries(r.in)) { inv[k] -= v; delete bench[k]; }
				inv[out] += r.out.filter((x) => x === out).length;
				renderBench(); refresh(); hint(`Crafted ${BY_ID[out].label}.`);
			};
			o.appendChild(btn);
		}
	}

	// ---- loadout / slots (left) ----
	function renderLoadout() {
		const rows = [];
		rows.push(`<div class="grouphead">Loadout</div>`);
		for (const key of ["front", "back", "battery"]) {
			const s = garage.slots[key];
			rows.push(`<div class="slot"><span class="slot__k">${key}</span><span class="slot__v">${s ? s.item.label : "—"}</span></div>`);
		}
		rows.push(`<div class="grouphead">Wheels</div>`);
		rows.push(`<div class="muted small">Select Grip/Slick tire then click a wheel.</div>`);
		rows.push(`<div class="grouphead">Weight</div><div class="weight">${garage.weight().toFixed(0)}</div>`);
		rows.push(`<button class="mini" id="clearall">Strip car</button>`);
		els.left.innerHTML = rows.join("");
		els.left.querySelector("#clearall").onclick = () => { garage.clearAll(); refresh(); };
	}

	function refresh() { renderInv(); renderLoadout(); }

	renderInv(); renderCraft(); renderLoadout();
	return { refresh, consumePending, hint };
}
