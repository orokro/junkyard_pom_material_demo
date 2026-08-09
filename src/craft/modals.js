/**
 * ============================================================================
 * craft/modals.js
 * ----------------------------------------------------------------------------
 * The two bottom-bar overlays:
 *   RECIPES (left)  — scrollable recipe list; affordable rows (inventory + what's
 *                     already on the car) are lit; click pulls the ingredients
 *                     into the crafting grid.
 *   KEYS (right)    — controllable features you currently have; bind one or more
 *                     keys to each (a key may fire many). While open, 2D labels
 *                     float over each feature on the model showing its binding.
 *                     Pressing a bound key flashes the feature (real weapon
 *                     animations come in the animation pass).
 * Each modal is a half-viewport panel with a soft inner edge; only one open at
 * a time. Item art uses cached 3D icon snapshots (icons.js).
 * ============================================================================
 */

import { RECIPES, BY_ID } from "./data.js";

const HAND_NAME = { slap_hand: "Slap", fist: "Fist", kancho: "Kancho" };
/** controllable-feature label for an item id, or null if it isn't hotkey-able */
function featureLabel(id) {
	if (!id) return null;
	if (id.startsWith("hyd_piston__")) return "Piston " + HAND_NAME[id.split("__")[1]];
	if (id.startsWith("hyd_arm__")) return "Arm " + HAND_NAME[id.split("__")[1]];
	if (id.startsWith("scorpion_tail")) return "Scorpion Tail";
	return { electromagnet: "Electromagnet", emp_gun: "EMP Fire", kancho: "Kancho",
		jet_thruster: "Jet Boost", launcher: "Launcher Fire", slick_tire: "Drift" }[id] || null;
}
const keyName = (e) => e.key === " " ? "Space" : e.key.length === 1 ? e.key.toUpperCase() : e.key;

export function initModals({ builder, carview, icons }) {
	const S = builder.state;
	const app = document.getElementById("app");
	const icon = (id) => icons ? icons.icon(id) : "";

	// ---------- DOM scaffold ----------
	const recipes = el(`<div id="recipesModal" class="modal left">
		<div class="mhead"><span class="mtitle">Recipes</span><button class="mclose">✕</button></div>
		<div class="rscroll"></div></div>`);
	const keys = el(`<div id="keysModal" class="modal right">
		<div class="mhead"><span class="mtitle">Keys</span><button class="mclose">✕</button></div>
		<div class="khint">Click <b>Bind</b>, then press a key. A key can fire many things.</div>
		<div class="kscroll"></div></div>`);
	const labels = el(`<div id="keyLabels"></div>`);
	app.append(recipes, keys, labels);
	const rscroll = recipes.querySelector(".rscroll");
	const kscroll = keys.querySelector(".kscroll");

	// ---------- bindings state ----------
	/** featureKey -> Set(keyName) */
	const binds = new Map();
	let listening = null;              // featureKey currently awaiting a keypress
	const featureKey = (a) => `${a.kind}:${a.id}:${a.ord ?? 0}`;

	// ---------- available materials (inventory + placed + slots) ----------
	function available() {
		const m = {}; const add = (id, n) => { if (id) m[id] = (m[id] || 0) + n; };
		for (const st of S.inv) add(st.id, st.count);
		for (const id of S.placed) add(id, 1);
		add(S.slots.front?.id, 1); add(S.slots.rear?.id, 1);
		if (S.slots.batteries) add("battery", S.slots.batteries.count);
		S.slots.tires.forEach((t) => add(t?.id, 1));
		S.slots.suspension.forEach((t) => add(t?.id, 1));
		return m;
	}

	// ---------- RECIPES list ----------
	function ingHtml(id, n) {
		return `<span class="ing"><img src="${icon(id)}" alt=""><span class="in">${BY_ID[id]?.label || id}</span>${n > 1 ? `<b>×${n}</b>` : ""}</span>`;
	}
	function renderRecipes() {
		const avail = available();
		rscroll.innerHTML = RECIPES.map((r, i) => {
			const can = Object.entries(r.in).every(([id, n]) => (avail[id] || 0) >= n);
			const ins = Object.entries(r.in).map(([id, n]) => ingHtml(id, n)).join("");
			const outs = [...new Set(r.out)].map((id) => `<span class="ing out"><img src="${icon(id)}" alt=""><span class="in">${BY_ID[id]?.label || id}</span></span>`).join("");
			return `<div class="recipe ${can ? "afford" : "dim"}" data-r="${i}">
				<div class="ins">${ins}</div><div class="rarrow">➜</div><div class="outs">${outs}</div></div>`;
		}).join("");
	}
	rscroll.addEventListener("click", (e) => {
		const row = e.target.closest(".recipe"); if (!row) return;
		builder.loadRecipe(RECIPES[+row.dataset.r].in);
		flash(row);
	});

	// ---------- KEYS list ----------
	function currentFeatures() {
		const out = [];
		for (const a of carview.anchors()) {
			const label = featureLabel(a.id); if (!label) continue;
			out.push({ ...a, label, fk: featureKey(a) });
		}
		// Jump: any suspension piston (no dedicated model anchor — pin to car centre)
		if (S.slots.suspension.some(Boolean)) out.push({ id: "jump", kind: "jump", ord: 0, label: "Jump", fk: "jump:jump:0", object: null });
		return out;
	}
	function chip(fk, k) { return `<span class="kchip" data-fk="${fk}" data-k="${k}">${k}<i>✕</i></span>`; }
	function renderKeys() {
		const feats = currentFeatures();
		if (!feats.length) { kscroll.innerHTML = `<div class="kempty">No controllable weapons on the car yet.<br>Attach a piston/arm/launcher, scorpion tail, magnet, EMP, jet, slick tire, or jump shock.</div>`; return; }
		kscroll.innerHTML = feats.map((f) => {
			const ks = [...(binds.get(f.fk) || [])];
			const chips = ks.length ? ks.map((k) => chip(f.fk, k)).join("") : `<span class="kunbound">unbound</span>`;
			return `<div class="krow ${listening === f.fk ? "listening" : ""}" data-fk="${f.fk}">
				<img class="kicon" src="${f.id === "jump" ? "" : icon(f.id)}" alt="">
				<span class="klabel">${f.label}</span>
				<span class="kbinds">${chips}</span>
				<button class="kbind">${listening === f.fk ? "Press a key…" : "＋ Bind"}</button></div>`;
		}).join("");
	}
	kscroll.addEventListener("click", (e) => {
		const rm = e.target.closest(".kchip");
		if (rm) { binds.get(rm.dataset.fk)?.delete(rm.dataset.k); renderKeys(); return; }
		const btn = e.target.closest(".kbind");
		if (btn) { const row = btn.closest(".krow"); listening = listening === row.dataset.fk ? null : row.dataset.fk; renderKeys(); }
	});

	// ---------- open / close (slide via .open) ----------
	function open(which) {
		const other = which === recipes ? keys : recipes;
		const isOpen = which.classList.contains("open");
		other.classList.remove("open");                  // slide the other out (simultaneously)
		if (!isOpen) { if (which === recipes) renderRecipes(); else renderKeys(); which.classList.add("open"); }
		else which.classList.remove("open");
		document.body.classList.toggle("recipes-open", recipes.classList.contains("open"));
		document.body.classList.toggle("keys-open", keys.classList.contains("open"));
		listening = null;
	}
	function close() { recipes.classList.remove("open"); keys.classList.remove("open"); document.body.classList.remove("recipes-open", "keys-open"); listening = null; }
	recipes.querySelector(".mclose").onclick = close;
	keys.querySelector(".mclose").onclick = close;
	document.getElementById("btn-recipes")?.addEventListener("click", () => open(recipes));
	document.getElementById("btn-keys")?.addEventListener("click", () => open(keys));

	// ---------- keyboard: bind capture + fire ----------
	window.addEventListener("keydown", (e) => {
		if (e.key === "Escape") {
			if (listening) { listening = null; renderKeys(); e.stopPropagation(); return; }
			if (recipes.classList.contains("open") || keys.classList.contains("open")) { close(); e.stopPropagation(); return; }
			return;
		}
		if (listening) {
			e.preventDefault(); e.stopPropagation();
			const k = keyName(e);
			if (!binds.has(listening)) binds.set(listening, new Set());
			binds.get(listening).add(k);
			listening = null; renderKeys();
			return;
		}
		// fire: flash every present feature bound to this key
		const k = keyName(e);
		const present = new Set(currentFeatures().map((f) => f.fk));
		for (const [fk, set] of binds) if (set.has(k) && present.has(fk)) fireFeature(fk);
	}, true);

	// ---------- 2D labels + firing feedback ----------
	const flashUntil = new Map();     // fk -> timestamp
	const lmap = new Map();           // fk -> label element
	function labelFor(fk) { let n = lmap.get(fk); if (!n) { n = el(`<div class="klabel2d"></div>`); labels.appendChild(n); lmap.set(fk, n); } return n; }
	/** flash a feature's label now (synchronous) and schedule it off — real weapon animations land in the animation pass */
	function fireFeature(fk) {
		flashUntil.set(fk, performance.now() + 260);
		const n = labelFor(fk); n.classList.add("fire");
		clearTimeout(n._ft); n._ft = setTimeout(() => { n.classList.remove("fire"); flashUntil.delete(fk); }, 260);
	}
	function tickLabels() {
		requestAnimationFrame(tickLabels);
		if (!keys.classList.contains("open")) { for (const [, n] of lmap) n.style.display = "none"; return; }
		const seen = new Set();
		for (const f of currentFeatures()) {
			seen.add(f.fk);
			const n = labelFor(f.fk);
			const ks = [...(binds.get(f.fk) || [])];
			n.innerHTML = `<span class="l-name">${f.label}</span>` + (ks.length ? ks.map((k) => `<span class="l-key">${k}</span>`).join("") : `<span class="l-key l-un">—</span>`);
			const pos = f.object ? f.screen : carCentreScreen();
			if (pos && pos.visible !== false) {
				n.style.display = "flex"; n.style.left = pos.x + "px"; n.style.top = (pos.y - 6) + "px";
				if ((flashUntil.get(f.fk) || 0) <= performance.now()) n.classList.remove("fire");
			} else n.style.display = "none";
		}
		for (const [fk, n] of lmap) if (!seen.has(fk)) n.style.display = "none";
	}
	function carCentreScreen() {
		const c = document.querySelector("#loadout .carview canvas"); if (!c) return null;
		const r = c.getBoundingClientRect(); return { x: r.left + r.width * 0.5, y: r.top + r.height * 0.32, visible: true };
	}
	requestAnimationFrame(tickLabels);

	// ---------- external refresh (builder changed) ----------
	function refresh() {
		if (recipes.classList.contains("open")) renderRecipes();
		if (keys.classList.contains("open")) renderKeys();
	}

	return { open, close, refresh, _binds: binds, _flash: flashUntil };
}

// tiny html -> element helper
function el(html) { const t = document.createElement("template"); t.innerHTML = html.trim(); return t.content.firstChild; }
// brief click feedback on a row
function flash(node) { node.classList.add("flash"); setTimeout(() => node.classList.remove("flash"), 220); }
