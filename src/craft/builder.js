/**
 * ============================================================================
 * craft/builder.js
 * ----------------------------------------------------------------------------
 * The interactive builder: inventory / crafting bench / output / slots state,
 * DOM rendering, and the drag-and-drop machine (Part 1 — DOM drag).
 *
 *   left-click : not holding -> pick up whole stack (or craft one output batch)
 *                holding     -> place it (empty), accumulate (same id in inv/out),
 *                               deposit/swap (bench), or fit into a slot
 *   right-click: take ONE into your hand (accumulates); over empty space cancels
 *   (browser context menu is suppressed everywhere)
 *
 * Crafting is shapeless + stack-friendly: a recipe matches if the bench holds
 * AT LEAST its inputs; grabbing an output consumes one batch and merges into the
 * held stack, so you can craft several in a row.
 *
 * The 3D car placement hand-off (dragging onto the model) is Part 2.
 * ============================================================================
 */

import { ITEMS, BY_ID, RECIPES } from "./data.js";
import { ghost } from "./thumbs.js";

const SLOT_ACCEPT = {
	front: ["electromagnet", "emp_gun", "chest_spikes", "kancho"],
	rear: ["jet_thruster", "scorpion_tail", "scorpion_tail__slap_hand", "scorpion_tail__fist", "scorpion_tail__kancho"],
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
/** an item is bench-usable if it's an ingredient in some recipe */
const craftable = (id) => RECIPES.some((r) => r.in[id] != null);

export function initBuilder(thumbs, opts) {
	// Back-compat: a bare function is the old onSlots callback.
	const onSlots = typeof opts === "function" ? opts : opts?.onSlots || null;
	const onHeld = typeof opts === "function" ? null : opts?.onHeld || null;
	const S = {
		inv: ITEMS.map((it) => ({ id: it.id, count: 200 })),
		bench: Array(9).fill(null),
		slots: { front: null, rear: null, batteries: null, tires: [null, null, null, null], suspension: [null, null, null, null] },
		placed: [],   // ids free-placed on the car (weight counts, visuals live in carview)
		held: null,
	};
	const $ = (s) => document.querySelector(s);
	const invgrid = $("#invgrid"), cgrid = $("#cgrid"), outcol = $("#outcol"), slotsrow = $("#slotsrow");

	// ---------- rendering ----------
	function renderInv() {
		invgrid.innerHTML = S.inv.map((st, i) =>
			st ? `<div class="itile invtile" data-item="${st.id}" data-container="inv" data-index="${i}"><span class="cnt">${st.count}</span></div>` : ""
		).join("");
	}
	function renderBench() {
		cgrid.innerHTML = S.bench.map((st, i) =>
			st ? `<div class="itile cell benchtile" data-item="${st.id}" data-container="bench" data-index="${i}"><span class="cnt">${st.count > 1 ? st.count : ""}</span></div>`
			   : `<div class="itile cell empty" data-container="bench" data-index="${i}"></div>`
		).join("");
	}
	function renderOutput() {
		outcol.innerHTML = matches().map((o, i) =>
			`<div class="itile cell outtile" data-item="${o.id}" data-container="out" data-index="${i}"><span class="cnt">${o.count > 1 ? "x" + o.count : ""}</span></div>`
		).join("");
	}
	function renderSlots() {
		slotsrow.innerHTML = SLOT_META.map((g) => {
			let cells = "";
			for (let i = 0; i < g.cells; i++) {
				const st = g.cells === 1 ? S.slots[g.key] : S.slots[g.key][i];
				const base = `class="itile cell slotcell" data-container="slot" data-slot="${g.key}" data-index="${i}"`;
				cells += st
					? `<div ${base} data-item="${st.id}">${st.count > 1 ? `<span class="cnt">x${st.count}</span>` : ""}</div>`
					: `<div ${base}></div>`;
			}
			return `<div class="slotgroup" data-cols="${g.cols}"><div class="slotcells">${cells}</div><div class="slotlabel">${g.label}</div></div>`;
		}).join("");
	}
	function updateStats() {
		let w = 0, batt = 0;
		const add = (st) => { if (st) w += (BY_ID[st.id]?.weight || 0) * (st.count || 1); };
		add(S.slots.front); add(S.slots.rear);
		if (S.slots.batteries) { batt = S.slots.batteries.count; w += (BY_ID.battery.weight || 0) * batt; }
		S.slots.tires.forEach(add); S.slots.suspension.forEach(add);
		for (const id of S.placed) w += (BY_ID[id]?.weight || 0);   // free-placed weapons
		$("#wt").textContent = w.toFixed(0);
		$("#charge").textContent = (100 + 100 * batt) + "%";
	}
	function renderAll() { renderInv(); renderBench(); renderOutput(); renderSlots(); updateStats(); thumbs.refresh(); highlight(); if (onSlots) onSlots(S.slots); }

	// ---------- crafting ----------
	function benchMs() { const m = {}; for (const st of S.bench) if (st) m[st.id] = (m[st.id] || 0) + st.count; return m; }
	function matches() {
		const ms = benchMs(), keys = Object.keys(ms), out = [], seen = new Set();
		for (const r of RECIPES) {
			const rk = Object.keys(r.in);
			if (rk.length !== keys.length || !rk.every((k) => ms[k] >= r.in[k])) continue;
			const counts = {};
			for (const o of r.out) counts[o] = (counts[o] || 0) + 1;
			for (const [id, count] of Object.entries(counts)) if (!seen.has(id)) { seen.add(id); out.push({ id, count, recipe: r }); }
		}
		return out;
	}
	function consume(recipe) {
		const need = { ...recipe.in };
		for (let b = 0; b < S.bench.length && Object.keys(need).length; b++) {
			const st = S.bench[b]; if (!st || !need[st.id]) continue;
			const t = Math.min(st.count, need[st.id]); st.count -= t; need[st.id] -= t;
			if (need[st.id] <= 0) delete need[st.id]; if (st.count <= 0) S.bench[b] = null;
		}
	}
	/** grab one output batch; merges into held if the same item */
	function craftGrab(i) {
		const o = matches()[i]; if (!o) return;
		if (S.held && S.held.id !== o.id) return;
		consume(o.recipe);
		S.held = S.held ? { id: S.held.id, count: S.held.count + o.count } : { id: o.id, count: o.count };
		setHeld(S.held);
	}

	// ---------- cell helpers ----------
	function cellStack(c, i, slot) {
		if (c === "inv") return S.inv[i];
		if (c === "bench") return S.bench[i];
		if (c === "slot") return (slot === "tires" || slot === "suspension") ? S.slots[slot][i] : S.slots[slot];
		return null;
	}
	function clearCell(c, i, slot) {
		if (c === "inv") S.inv.splice(i, 1);
		else if (c === "bench") S.bench[i] = null;
		else if (c === "slot") { if (slot === "tires" || slot === "suspension") S.slots[slot][i] = null; else S.slots[slot] = null; }
	}
	function give(st) { const same = S.inv.find((s) => s.id === st.id); if (same) same.count += st.count; else S.inv.push(st); }
	function take(n) { if (!S.held) return; S.held.count -= n; setHeld(S.held.count > 0 ? S.held : null); }
	function setHeld(st) { S.held = st && st.count > 0 ? st : null; ghost.id = S.held ? S.held.id : null; document.body.classList.toggle("dragging", !!S.held); if (onHeld) onHeld(S.held); }
	function cancel() { if (!S.held) return; give(S.held); setHeld(null); renderAll(); }

	function dropSlot(slot, i) {
		if (!(SLOT_ACCEPT[slot] || []).includes(S.held.id)) return;
		if (slot === "batteries") { const cur = S.slots.batteries; S.slots.batteries = { id: "battery", count: (cur ? cur.count : 0) + S.held.count }; take(S.held.count); }
		else if (slot === "tires" || slot === "suspension") { const old = S.slots[slot][i]; S.slots[slot][i] = { id: S.held.id, count: 1 }; if (old) give(old); take(1); }
		else { const old = S.slots[slot]; S.slots[slot] = { id: S.held.id, count: 1 }; if (old) give(old); take(1); }
	}

	// ---------- interactions ----------
	function leftClick(c, i, slot) {
		if (c === "out") { craftGrab(i); renderAll(); return; }
		const st = cellStack(c, i, slot);
		if (!S.held) { if (st) { setHeld(st); clearCell(c, i, slot); } }
		else if (c === "inv") {
			if (st && st.id === S.held.id) { S.held.count += st.count; S.inv.splice(i, 1); setHeld(S.held); }   // accumulate
			else { S.inv.splice(i, 0, { id: S.held.id, count: S.held.count }); setHeld(null); }                 // deposit
		} else if (c === "bench") {
			if (!st) { S.bench[i] = { id: S.held.id, count: S.held.count }; setHeld(null); }
			else if (st.id === S.held.id) { st.count += S.held.count; setHeld(null); }
			else { const old = st; S.bench[i] = { id: S.held.id, count: S.held.count }; setHeld(old); }
		} else if (c === "slot") { dropSlot(slot, i); }
		renderAll();
	}
	/** right-click: holding -> place ONE; not holding -> take ONE (accumulates) */
	function rightClick(c, i, slot) {
		if (c === "out") { craftGrab(i); renderAll(); return; }
		if (S.held) placeOne(c, i, slot);
		else {
			const st = cellStack(c, i, slot);
			if (!st || st.count < 1) return;
			S.held = { id: st.id, count: 1 }; setHeld(S.held);
			st.count -= 1; if (st.count <= 0) clearCell(c, i, slot);
		}
		renderAll();
	}
	/** deposit a single held item into a cell (place-one) */
	function placeOne(c, i, slot) {
		if (c === "inv") {
			const st = S.inv[i];
			if (!st) { S.inv.splice(i, 0, { id: S.held.id, count: 1 }); take(1); }
			else if (st.id === S.held.id) { st.count += 1; take(1); }
		} else if (c === "bench") {
			const st = S.bench[i];
			if (!st) { S.bench[i] = { id: S.held.id, count: 1 }; take(1); }
			else if (st.id === S.held.id) { st.count += 1; take(1); }
		} else if (c === "slot") {
			if (!(SLOT_ACCEPT[slot] || []).includes(S.held.id)) return;
			if (slot === "batteries") { const cur = S.slots.batteries; S.slots.batteries = { id: "battery", count: (cur ? cur.count : 0) + 1 }; take(1); }
			else if (slot === "tires" || slot === "suspension") { if (!S.slots[slot][i]) { S.slots[slot][i] = { id: S.held.id, count: 1 }; take(1); } }
			else { if (!S.slots[slot]) { S.slots[slot] = { id: S.held.id, count: 1 }; take(1); } }
		}
	}
	/** dropping a slot-type item onto the 3D car auto-fills its slot */
	function dropOnCar() {
		const type = Object.keys(SLOT_ACCEPT).find((k) => SLOT_ACCEPT[k].includes(S.held.id));
		if (!type) return;  // free-placeable item -> carview handles the raycast placement
		if (type === "tires" || type === "suspension") { let idx = S.slots[type].findIndex((x) => !x); if (idx < 0) idx = 0; dropSlot(type, idx); }
		else dropSlot(type, 0);
		renderAll();
	}

	// ---- free placement hand-off (carview owns the 3D raycast) ----
	/** carview placed one held item on the car -> consume one from the hand */
	function onPlace(id) {
		if (!S.held || S.held.id !== id) return;
		S.placed.push(id);
		take(1);          // setHeld() re-syncs carview's ghost via onHeld
		renderAll();
	}
	/** carview detached a placed item -> pick it back up (accumulates if same) */
	function onDetach(id) {
		const i = S.placed.indexOf(id); if (i >= 0) S.placed.splice(i, 1);
		if (S.held && S.held.id === id) S.held.count += 1; else S.held = { id, count: 1 };
		setHeld(S.held);
		renderAll();
	}

	// ---------- highlight ----------
	function highlight() {
		document.querySelectorAll(".droppable").forEach((e) => e.classList.remove("droppable"));
		if (!S.held) return;
		const id = S.held.id;
		invgrid.classList.add("droppable");
		invgrid.querySelectorAll(".itile").forEach((e) => e.classList.add("droppable"));
		if (craftable(id)) cgrid.querySelectorAll(".itile").forEach((e) => e.classList.add("droppable"));  // only real ingredients
		document.querySelectorAll(".slotcell").forEach((e) => { if ((SLOT_ACCEPT[e.dataset.slot] || []).includes(id)) e.classList.add("droppable"); });
	}

	// ---------- cursor label ----------
	const label = document.createElement("div"); label.id = "cursorlabel"; label.style.display = "none"; document.body.appendChild(label);
	function updateLabel(x, y, target) {
		if (S.held) { label.textContent = "×" + S.held.count; label.className = "count"; label.style.display = "block"; }
		else { const t = target && target.closest && target.closest("[data-item]"); if (t) { label.textContent = BY_ID[t.dataset.item]?.label || t.dataset.item; label.className = "name"; label.style.display = "block"; } else label.style.display = "none"; }
		label.style.left = (x + 15) + "px"; label.style.top = (y + 18) + "px";
	}

	// ---------- events ----------
	const cellOf = (e) => e.target.closest("[data-container]");
	document.addEventListener("pointerdown", (e) => {
		if (e.button !== 0) return;
		const el = cellOf(e);
		if (el) { const { container, index, slot } = el.dataset; leftClick(container, index != null ? +index : 0, slot); e.preventDefault(); }
		else if (S.held && e.target.closest("#loadout")) { dropOnCar(); e.preventDefault(); }
		else if (S.held && e.target.closest("#inventory .pbody")) { give({ id: S.held.id, count: S.held.count }); setHeld(null); renderAll(); e.preventDefault(); }
		updateLabel(e.clientX, e.clientY, e.target);
	});
	document.addEventListener("contextmenu", (e) => {
		e.preventDefault(); // suppress the browser context menu everywhere
		const el = cellOf(e);
		if (el) { const { container, index, slot } = el.dataset; rightClick(container, index != null ? +index : 0, slot); }
		else if (S.held && !e.target.closest("#loadout")) cancel();   // over the car: let carview handle it, don't cancel
		updateLabel(e.clientX, e.clientY, e.target);
	});
	window.addEventListener("pointermove", (e) => { ghost.x = e.clientX; ghost.y = e.clientY; updateLabel(e.clientX, e.clientY, e.target); });
	window.addEventListener("keydown", (e) => { if (e.key === "Escape") cancel(); });

	renderAll();
	return { state: S, renderAll, leftClick, rightClick, craftGrab, cancel, onPlace, onDetach };
}
