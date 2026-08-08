/**
 * ============================================================================
 * craft/builder.js
 * ----------------------------------------------------------------------------
 * The interactive builder: inventory / crafting bench / output / slots state,
 * DOM rendering, and the drag-and-drop machine (Part 1 — DOM drag).
 *
 *   - left-click a filled cell  -> pick up the whole stack (ghost follows cursor)
 *   - left-click a target cell   -> drop (place / merge / swap; slots take 1)
 *   - right-click while holding   -> place ONE from the stack
 *   - drop onto empty inventory   -> append
 *   - valid drop targets light up (.droppable) by type while holding
 *   - crafting is shapeless + many-to-many: bench multiset -> output options;
 *     grabbing an output consumes the inputs.
 *
 * The 3D car placement hand-off (dragging onto the model) is Part 2.
 * ============================================================================
 */

import { ITEMS, BY_ID, RECIPES } from "./data.js";
import { ghost } from "./thumbs.js";

/** which item ids each slot group accepts */
const SLOT_ACCEPT = {
	front: ["electromagnet", "emp_gun", "chest_spikes", "kancho"],
	rear: ["jet_thruster", "scorpion_tail"],
	batteries: ["battery"],
	tires: ["grip_tire", "slick_tire"],
	suspension: ["spring", "hyd_piston"],
};
const SLOT_META = [
	{ key: "rear", label: "Rear", cols: 1, cells: 1 },
	{ key: "front", label: "Front", cols: 1, cells: 1 },
	{ key: "batteries", label: "Batteries", cols: 1, cells: 1 },
	{ key: "tires", label: "Tires", cols: 2, cells: 4 },
	{ key: "suspension", label: "Suspension", cols: 2, cells: 4 },
];

/** @param {object} thumbs initThumbs() handle */
export function initBuilder(thumbs) {
	const S = {
		inv: ITEMS.map((it) => ({ id: it.id, count: 200 })),
		bench: Array(9).fill(null),
		slots: { front: null, rear: null, batteries: null, tires: [null, null, null, null], suspension: [null, null, null, null] },
		held: null,
	};

	const $ = (s) => document.querySelector(s);
	const invgrid = $("#invgrid"), cgrid = $("#cgrid"), outcol = $("#outcol"), slotsrow = $("#slotsrow");

	// ---------- rendering ----------
	const tile = (id, attrs, count) => {
		const c = count != null && count > 1 ? `<span class="cnt">${count}</span>` : (count === 1 ? "" : "");
		return `<div class="itile" data-item="${id}" ${attrs} title="${BY_ID[id]?.label || id}">${c}</div>`;
	};
	const empty = (attrs, cls = "") => `<div class="itile empty ${cls}" ${attrs}></div>`;

	function renderInv() {
		invgrid.innerHTML = S.inv.map((st, i) =>
			st ? `<div class="itile invtile" data-item="${st.id}" data-container="inv" data-index="${i}" title="${BY_ID[st.id]?.label}"><span class="cnt">${st.count}</span></div>` : ""
		).join("");
	}
	function renderBench() {
		cgrid.innerHTML = S.bench.map((st, i) =>
			st ? `<div class="itile cell benchtile" data-item="${st.id}" data-container="bench" data-index="${i}"><span class="cnt">${st.count > 1 ? st.count : ""}</span></div>`
			   : `<div class="itile cell empty" data-container="bench" data-index="${i}"></div>`
		).join("");
	}
	function renderOutput() {
		const outs = matches();
		outcol.innerHTML = outs.map((o, i) =>
			`<div class="itile cell outtile" data-item="${o.id}" data-container="out" data-index="${i}"><span class="cnt">${o.count > 1 ? "x" + o.count : ""}</span></div>`
		).join("") || "";
	}
	function renderSlots() {
		slotsrow.innerHTML = SLOT_META.map((g) => {
			let cells = "";
			for (let i = 0; i < g.cells; i++) {
				const st = g.cells === 1 ? S.slots[g.key] : S.slots[g.key][i];
				const attrs = `class="itile cell slotcell" data-container="slot" data-slot="${g.key}" data-index="${i}"`;
				cells += st
					? `<div ${attrs.replace("class=\"itile cell slotcell\"", `class="itile cell slotcell" data-item="${st.id}"`)}>${st.count > 1 ? `<span class="cnt">x${st.count}</span>` : ""}</div>`
					: `<div ${attrs}></div>`;
			}
			return `<div class="slotgroup" data-cols="${g.cols}"><div class="slotcells">${cells}</div><div class="slotlabel">${g.label}</div></div>`;
		}).join("");
	}
	function renderAll() { renderInv(); renderBench(); renderOutput(); renderSlots(); updateStats(); thumbs.refresh(); }

	function updateStats() {
		let w = 0, batt = 0;
		const add = (st) => { if (st) w += (BY_ID[st.id]?.weight || 0) * (st.count || 1); };
		add(S.slots.front); add(S.slots.rear);
		if (S.slots.batteries) { batt = S.slots.batteries.count; w += (BY_ID.battery.weight || 0) * batt; }
		S.slots.tires.forEach(add); S.slots.suspension.forEach(add);
		$("#wt").textContent = w.toFixed(0);
		$("#charge").textContent = (100 + 100 * batt) + "%";
	}

	// ---------- crafting ----------
	function benchMs() { const m = {}; for (const st of S.bench) if (st) m[st.id] = (m[st.id] || 0) + st.count; return m; }
	function matches() {
		const ms = benchMs(), keys = Object.keys(ms);
		const out = []; const seen = new Set();
		for (const r of RECIPES) {
			const rk = Object.keys(r.in);
			if (rk.length !== keys.length || !rk.every((k) => ms[k] === r.in[k])) continue;
			const counts = {};
			for (const o of r.out) counts[o] = (counts[o] || 0) + 1;
			for (const [id, count] of Object.entries(counts)) { const key = id; if (!seen.has(key)) { seen.add(key); out.push({ id, count, recipe: r }); } }
		}
		return out;
	}

	// ---------- drag machine ----------
	function highlight(on) {
		document.querySelectorAll(".droppable").forEach((e) => e.classList.remove("droppable"));
		if (!on || !S.held) return;
		const id = S.held.id;
		invgrid.classList.add("droppable");
		invgrid.querySelectorAll(".itile").forEach((e) => e.classList.add("droppable"));
		cgrid.querySelectorAll(".itile").forEach((e) => e.classList.add("droppable"));
		document.querySelectorAll(".slotcell").forEach((e) => {
			if ((SLOT_ACCEPT[e.dataset.slot] || []).includes(id)) e.classList.add("droppable");
		});
	}
	function setHeld(stack) {
		S.held = stack && stack.count > 0 ? stack : null;
		ghost.id = S.held ? S.held.id : null;
		document.body.classList.toggle("dragging", !!S.held);
		highlight(!!S.held);
	}

	function pick(container, index, slot) {
		let st = null;
		if (container === "inv") { st = S.inv[index]; if (st) S.inv.splice(index, 1); }
		else if (container === "bench") { st = S.bench[index]; S.bench[index] = null; }
		else if (container === "slot") {
			if (slot === "tires" || slot === "suspension") { st = S.slots[slot][index]; S.slots[slot][index] = null; }
			else { st = S.slots[slot]; S.slots[slot] = null; }
		} else if (container === "out") { st = craft(index); }
		if (st) { setHeld(st); renderAll(); }
	}

	/** grab an output: consume the matching recipe's inputs from the bench. */
	function craft(i) {
		const outs = matches(); const o = outs[i]; if (!o) return null;
		const need = { ...o.recipe.in };
		for (let b = 0; b < S.bench.length && Object.keys(need).length; b++) {
			const st = S.bench[b]; if (!st || !need[st.id]) continue;
			const take = Math.min(st.count, need[st.id]);
			st.count -= take; need[st.id] -= take; if (need[st.id] <= 0) delete need[st.id];
			if (st.count <= 0) S.bench[b] = null;
		}
		return { id: o.id, count: o.count };
	}

	function drop(container, index, slot, one) {
		if (!S.held) return;
		const amt = one ? 1 : S.held.count;
		if (container === "inv") {
			const tgt = S.inv[index];
			if (tgt && tgt.id === S.held.id) { tgt.count += amt; take(amt); }
			else { S.inv.splice(index, 0, { id: S.held.id, count: amt }); take(amt); }
		} else if (container === "bench") {
			const tgt = S.bench[index];
			if (!tgt) { S.bench[index] = { id: S.held.id, count: amt }; take(amt); }
			else if (tgt.id === S.held.id) { tgt.count += amt; take(amt); }
			else if (!one) { const old = tgt; S.bench[index] = S.held; setHeld(old); renderAll(); return; }
		} else if (container === "slot") {
			if (!(SLOT_ACCEPT[slot] || []).includes(S.held.id)) return; // wrong type
			if (slot === "batteries") {
				const cur = S.slots.batteries;
				S.slots.batteries = { id: "battery", count: (cur ? cur.count : 0) + 1 }; take(1);
			} else if (slot === "tires" || slot === "suspension") {
				if (!S.slots[slot][index]) { S.slots[slot][index] = { id: S.held.id, count: 1 }; take(1); }
				else { const old = S.slots[slot][index]; S.slots[slot][index] = { id: S.held.id, count: 1 }; give(old); take(1); }
			} else { // front/rear single
				const old = S.slots[slot];
				S.slots[slot] = { id: S.held.id, count: 1 }; if (old) give(old); take(1);
			}
		} else if (container === "invbg") {
			const same = S.inv.find((s) => s.id === S.held.id);
			if (same) same.count += amt; else S.inv.push({ id: S.held.id, count: amt });
			take(amt);
		}
		renderAll();
	}
	/** remove `n` from held */
	function take(n) { if (!S.held) return; S.held.count -= n; if (S.held.count <= 0) setHeld(null); else setHeld(S.held); }
	/** return a stack to inventory */
	function give(st) { const same = S.inv.find((s) => s.id === st.id); if (same) same.count += st.count; else S.inv.push(st); }

	// ---------- events ----------
	function cellOf(e) { return e.target.closest("[data-container]"); }
	document.addEventListener("pointerdown", (e) => {
		if (e.button !== 0) return;
		const el = cellOf(e);
		if (el) {
			const { container, index, slot } = el.dataset;
			if (!S.held) pick(container, index != null ? +index : 0, slot);
			else drop(container, index != null ? +index : 0, slot, false);
			e.preventDefault();
		} else if (S.held && e.target.closest("#invgrid")) {
			drop("invbg"); e.preventDefault();
		}
	});
	document.addEventListener("contextmenu", (e) => {
		if (!S.held) return;
		const el = cellOf(e);
		if (el) { const { container, index, slot } = el.dataset; drop(container, index != null ? +index : 0, slot, true); e.preventDefault(); }
	});
	window.addEventListener("pointermove", (e) => { ghost.x = e.clientX; ghost.y = e.clientY; });
	window.addEventListener("keydown", (e) => { if (e.key === "Escape" && S.held) { give(S.held); setHeld(null); renderAll(); } });

	renderAll();
	return { state: S, renderAll };
}
