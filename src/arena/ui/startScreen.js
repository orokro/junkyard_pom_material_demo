/**
 * ============================================================================
 * arena/ui/startScreen.js
 * ----------------------------------------------------------------------------
 * Builds the Arena POC's start-screen overlay form from the WORLD_GROUPS
 * descriptors in arena/config.js. Handles seed persistence (localStorage), the
 * roll-seed button, value coercion, a back-to-hub link, and firing an onStart
 * callback with the assembled world config when the user launches.
 *
 * Structurally the same as the junkyard's start screen (shared look/feel) but
 * an independent copy driven by the arena's own config + settings modules.
 * ============================================================================
 */

import { WORLD_GROUPS } from "../config.js";
import { rollSeed } from "../seed.js";
import { loadSettings, saveSettings, loadPresets, savePresets } from "../settings.js";

/**
 * Copy text to the clipboard (async API with a legacy fallback).
 * @param {string} text
 * @returns {Promise<boolean>} whether the copy appears to have succeeded.
 */
async function copyText(text) {
	try {
		await navigator.clipboard.writeText(text);
		return true;
	} catch {
		try {
			const ta = document.createElement("textarea");
			ta.value = text;
			ta.style.position = "fixed";
			ta.style.opacity = "0";
			document.body.appendChild(ta);
			ta.select();
			const ok = document.execCommand("copy");
			ta.remove();
			return ok;
		} catch {
			return false;
		}
	}
}

/**
 * Briefly show confirmation text on a button, then restore the original label.
 * @param {HTMLButtonElement} btn @param {string} msg
 * @returns {void}
 */
function flashButton(btn, msg) {
	const prev = btn.textContent;
	btn.textContent = msg;
	btn.disabled = true;
	setTimeout(() => { btn.textContent = prev; btn.disabled = false; }, 1200);
}

/**
 * Create a single field control and return { wrapper, read, input }.
 * @param {import("../config.js").FieldDef} field Field descriptor.
 * @returns {{ wrapper: HTMLElement, read: () => (string|number|boolean), input: HTMLInputElement }}
 */
function createField(field) {
	const wrapper = document.createElement("div");
	wrapper.className = field.type === "bool" ? "field field--bool" : "field";

	const input = document.createElement("input");
	const id = `f_${field.key}`;
	input.id = id;

	if (field.type === "bool") {
		input.type = "checkbox";
		input.checked = Boolean(field.value);
	} else if (field.type === "number") {
		input.type = "number";
		input.value = String(field.value);
		if (field.min !== undefined) input.min = String(field.min);
		if (field.max !== undefined) input.max = String(field.max);
		if (field.step !== undefined) input.step = String(field.step);
	} else {
		input.type = "text";
		input.value = String(field.value);
	}

	const label = document.createElement("label");
	label.htmlFor = id;
	label.textContent = field.label;

	wrapper.appendChild(input);
	wrapper.appendChild(label);

	if (field.hint) {
		const hint = document.createElement("span");
		hint.className = "hint";
		hint.textContent = field.hint;
		wrapper.appendChild(hint);
	}

	/** @returns {string|number|boolean} Coerced current value. */
	const read = () => {
		if (field.type === "bool") return input.checked;
		if (field.type === "number") return Number(input.value);
		return input.value;
	};

	/** @param {*} value Write a value back into the control. */
	const set = (value) => {
		if (value === undefined || value === null) return;
		if (field.type === "bool") input.checked = Boolean(value);
		else input.value = String(value);
	};

	return { wrapper, read, set, input };
}

/**
 * Render the start screen into a host element.
 * @param {HTMLElement} host Container element (#start-screen).
 * @param {(config: Record<string, *>) => void} onStart Called with world config.
 * @returns {void}
 */
export function renderStartScreen(host, onStart) {
	host.innerHTML = "";

	// Restore last-used settings (falling back to defaults per field).
	const saved = loadSettings() || {};

	/** @type {Record<string, () => (string|number|boolean)>} */
	const readers = {};
	/** @type {Record<string, (v:*) => void>} */
	const setters = {};
	/** @type {HTMLInputElement|null} */
	let seedInput = null;

	const card = document.createElement("div");
	card.className = "card";

	// Header (with a link back to the POC hub).
	const header = document.createElement("div");
	header.className = "card__header";
	header.innerHTML = `
		<a class="card__back" href="./index.html">← All POCs</a>
		<h1 class="card__title">Dumper Cars <span class="spark">·</span> Arena Generator</h1>
		<p class="card__subtitle">Procedural bumper-car / demolition-derby arena POC — set a seed and size, then walk or fly the floor.</p>
	`;
	card.appendChild(header);

	// Body.
	const body = document.createElement("div");
	body.className = "card__body";

	const groupsWrap = document.createElement("div");
	groupsWrap.className = "groups";

	for (const group of WORLD_GROUPS) {
		if (group.title === "Seed") {
			// Seed gets a dedicated full-width row with a roll button.
			const seedField = createField(group.fields[0]);
			readers[group.fields[0].key] = seedField.read;
			setters[group.fields[0].key] = seedField.set;
			seedInput = seedField.input;

			seedInput.value = saved.seed && String(saved.seed).length ? String(saved.seed) : rollSeed();

			const rollBtn = document.createElement("button");
			rollBtn.type = "button";
			rollBtn.className = "btn btn--roll";
			rollBtn.textContent = "🎲 Roll";
			rollBtn.addEventListener("click", () => {
				seedInput.value = rollSeed();
			});

			const row = document.createElement("div");
			row.className = "seed-row";
			row.appendChild(seedField.wrapper);
			row.appendChild(rollBtn);
			body.appendChild(row);
			continue;
		}

		const groupEl = document.createElement("div");
		groupEl.className = "group";
		const title = document.createElement("h2");
		title.className = "group__title";
		title.textContent = group.title;
		groupEl.appendChild(title);

		for (const field of group.fields) {
			const initial = saved[field.key] !== undefined ? saved[field.key] : field.value;
			const control = createField({ ...field, value: initial });
			readers[field.key] = control.read;
			setters[field.key] = control.set;
			groupEl.appendChild(control.wrapper);
		}
		groupsWrap.appendChild(groupEl);
	}

	body.appendChild(groupsWrap);

	/** @returns {Record<string, *>} Current form values as a world config (seed included). */
	function readConfig() {
		/** @type {Record<string, *>} */
		const config = {};
		for (const [key, read] of Object.entries(readers)) config[key] = read();
		if (!config.seed || String(config.seed).trim() === "") config.seed = rollSeed();
		config.seed = String(config.seed).trim();
		return config;
	}

	/** @param {Record<string, *>} cfg Write known keys from a config back into the form. */
	function applyConfig(cfg) {
		if (!cfg || typeof cfg !== "object") return;
		for (const [key, set] of Object.entries(setters)) {
			if (cfg[key] !== undefined) set(cfg[key]);
		}
	}

	// ---- Presets (save/load named configs + JSON import/export) --------------
	let presets = loadPresets();

	const presetsWrap = document.createElement("div");
	presetsWrap.className = "presets";

	const presetsHead = document.createElement("div");
	presetsHead.className = "presets__head";
	const presetsTitle = document.createElement("h2");
	presetsTitle.className = "group__title";
	presetsTitle.textContent = "Presets";
	presetsHead.appendChild(presetsTitle);

	const presetsActions = document.createElement("div");
	presetsActions.className = "presets__actions";

	const saveBtn = document.createElement("button");
	saveBtn.type = "button";
	saveBtn.className = "btn";
	saveBtn.textContent = "💾 Save preset";

	const copyBtn = document.createElement("button");
	copyBtn.type = "button";
	copyBtn.className = "btn";
	copyBtn.textContent = "📋 Copy JSON";

	const loadJsonBtn = document.createElement("button");
	loadJsonBtn.type = "button";
	loadJsonBtn.className = "btn";
	loadJsonBtn.textContent = "📥 Load JSON";

	presetsActions.appendChild(saveBtn);
	presetsActions.appendChild(copyBtn);
	presetsActions.appendChild(loadJsonBtn);
	presetsHead.appendChild(presetsActions);
	presetsWrap.appendChild(presetsHead);

	const presetsList = document.createElement("div");
	presetsList.className = "presets__list";
	presetsWrap.appendChild(presetsList);

	/** @returns {void} Redraw the saved-preset rows. */
	function renderPresets() {
		presetsList.innerHTML = "";
		if (!presets.length) {
			const empty = document.createElement("span");
			empty.className = "presets__empty";
			empty.textContent = "No saved presets yet. Configure an arena and hit “Save preset”.";
			presetsList.appendChild(empty);
			return;
		}
		presets.forEach((preset, i) => {
			const row = document.createElement("div");
			row.className = "preset";

			const name = document.createElement("span");
			name.className = "preset__name";
			name.textContent = preset.name;
			name.title = `${preset.config.seed ?? ""}`;

			const loadBtn = document.createElement("button");
			loadBtn.type = "button";
			loadBtn.className = "btn btn--sm";
			loadBtn.textContent = "Load";
			loadBtn.addEventListener("click", () => {
				applyConfig(preset.config);
				flashButton(loadBtn, "Loaded ✓");
			});

			const delBtn = document.createElement("button");
			delBtn.type = "button";
			delBtn.className = "btn btn--sm btn--danger";
			delBtn.textContent = "✕";
			delBtn.title = "Delete preset";
			delBtn.addEventListener("click", () => {
				if (!confirm(`Delete preset “${preset.name}”?`)) return;
				presets.splice(i, 1);
				savePresets(presets);
				renderPresets();
			});

			row.appendChild(name);
			row.appendChild(loadBtn);
			row.appendChild(delBtn);
			presetsList.appendChild(row);
		});
	}
	renderPresets();

	saveBtn.addEventListener("click", () => {
		const name = (prompt("Preset name:") || "").trim();
		if (!name) return;
		const config = readConfig();
		const existing = presets.findIndex((p) => p.name === name);
		if (existing >= 0) presets[existing] = { name, config };
		else presets.push({ name, config });
		savePresets(presets);
		renderPresets();
		flashButton(saveBtn, "Saved ✓");
	});

	copyBtn.addEventListener("click", async () => {
		const ok = await copyText(JSON.stringify(readConfig(), null, 2));
		flashButton(copyBtn, ok ? "Copied ✓" : "Copy failed");
	});

	loadJsonBtn.addEventListener("click", () => {
		const raw = prompt("Paste a settings JSON (a config, or a saved preset):");
		if (!raw) return;
		try {
			const parsed = JSON.parse(raw);
			const cfg = parsed && parsed.config ? parsed.config : parsed;
			applyConfig(cfg);
			flashButton(loadJsonBtn, "Loaded ✓");
		} catch {
			flashButton(loadJsonBtn, "Invalid JSON");
		}
	});

	body.appendChild(presetsWrap);
	card.appendChild(body);

	// Footer.
	const footer = document.createElement("div");
	footer.className = "card__footer";
	const note = document.createElement("span");
	note.className = "note";
	note.textContent = "Settings persist between sessions · Tab toggles walk/fly in-world.";
	const startBtn = document.createElement("button");
	startBtn.type = "button";
	startBtn.className = "btn btn--start";
	startBtn.textContent = "Start ▸";
	footer.appendChild(note);
	footer.appendChild(startBtn);
	card.appendChild(footer);

	host.appendChild(card);

	// Launch.
	startBtn.addEventListener("click", () => {
		const config = readConfig();
		if (seedInput) seedInput.value = String(config.seed); // reflect any auto-rolled seed
		saveSettings(config);
		onStart(config);
	});
}
