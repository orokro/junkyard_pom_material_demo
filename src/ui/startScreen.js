/**
 * ============================================================================
 * ui/startScreen.js
 * ----------------------------------------------------------------------------
 * Builds the start-screen overlay form from the WORLD_GROUPS descriptors in
 * config.js. Handles seed persistence (localStorage), the roll-seed button,
 * value coercion, and firing an onStart callback with the assembled world
 * config when the user launches.
 * ============================================================================
 */

import { WORLD_GROUPS } from "../config.js";
import { rollSeed, loadLastSeed, saveLastSeed } from "../seed.js";

/**
 * Create a single field control and return { wrapper, read }.
 * @param {import("../config.js").FieldDef} field Field descriptor.
 * @returns {{ wrapper: HTMLElement, read: () => (string|number|boolean) }}
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

	return { wrapper, read, input };
}

/**
 * Render the start screen into a host element.
 * @param {HTMLElement} host Container element (#start-screen).
 * @param {(config: Record<string, *>) => void} onStart Called with world config.
 * @returns {void}
 */
export function renderStartScreen(host, onStart) {
	host.innerHTML = "";

	/** @type {Record<string, () => (string|number|boolean)>} */
	const readers = {};
	/** @type {HTMLInputElement|null} */
	let seedInput = null;

	const card = document.createElement("div");
	card.className = "card";

	// Header.
	const header = document.createElement("div");
	header.className = "card__header";
	header.innerHTML = `
		<h1 class="card__title">Dumper Cars <span class="spark">·</span> Junkyard Generator</h1>
		<p class="card__subtitle">Procedural scrap-map POC — set a seed and parameters, then fly through.</p>
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
			seedInput = seedField.input;

			const stored = loadLastSeed();
			seedInput.value = stored && stored.length ? stored : rollSeed();

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
			const control = createField(field);
			readers[field.key] = control.read;
			groupEl.appendChild(control.wrapper);
		}
		groupsWrap.appendChild(groupEl);
	}

	body.appendChild(groupsWrap);
	card.appendChild(body);

	// Footer.
	const footer = document.createElement("div");
	footer.className = "card__footer";
	const note = document.createElement("span");
	note.className = "note";
	note.textContent = "Phase 1 — UI only. The 3D scene arrives next phase.";
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
		/** @type {Record<string, *>} */
		const config = {};
		for (const [key, read] of Object.entries(readers)) {
			config[key] = read();
		}
		if (!config.seed || String(config.seed).trim() === "") {
			config.seed = rollSeed();
		}
		config.seed = String(config.seed).trim();
		saveLastSeed(config.seed);
		onStart(config);
	});
}
