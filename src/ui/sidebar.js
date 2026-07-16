/**
 * ============================================================================
 * ui/sidebar.js
 * ----------------------------------------------------------------------------
 * Runtime control sidebar built with Tweakpane from the RUNTIME_GROUPS
 * descriptors. Binds live to a runtime-config object and notifies a callback
 * on any change (so later phases can push values into the camera / POM shader).
 * Also mounts action buttons (return home, back to setup).
 * ============================================================================
 */

import { Pane } from "tweakpane";
import { RUNTIME_GROUPS } from "../config.js";

/**
 * @typedef {object} SidebarHandlers
 * @property {(key: string, value: *) => void} [onChange] Fired on any binding change.
 * @property {() => void} [onReturnHome] Fired by the "Return home" button.
 * @property {() => void} [onBackToSetup] Fired by the "Back to setup" button.
 * @property {() => void} [onExport] Fired by the "Export .glb" button.
 */

/**
 * Mount the Tweakpane sidebar.
 * @param {HTMLElement} container Host element (#sidebar).
 * @param {Record<string, *>} runtimeConfig Live runtime-config object (mutated in place).
 * @param {SidebarHandlers} [handlers] Optional callbacks.
 * @returns {{ pane: Pane, dispose: () => void }} Handle for teardown.
 */
export function mountSidebar(container, runtimeConfig, handlers = {}) {
	container.innerHTML = "";

	const pane = new Pane({ container, title: "Live controls" });

	for (const group of RUNTIME_GROUPS) {
		const folder = pane.addFolder({ title: group.title, expanded: true });
		for (const field of group.fields) {
			/** @type {Record<string, *>} */
			const opts = { label: field.label };
			if (field.type === "number") {
				if (field.min !== undefined) opts.min = field.min;
				if (field.max !== undefined) opts.max = field.max;
				if (field.step !== undefined) opts.step = field.step;
			}
			const binding = folder.addBinding(runtimeConfig, field.key, opts);
			binding.on("change", (ev) => {
				handlers.onChange?.(field.key, ev.value);
			});
		}
	}

	// Action buttons live outside the Pane so they can use app styling.
	const actions = document.createElement("div");
	actions.className = "sidebar__actions";

	const homeBtn = document.createElement("button");
	homeBtn.type = "button";
	homeBtn.className = "btn";
	homeBtn.textContent = "⌂ Return home";
	homeBtn.addEventListener("click", () => handlers.onReturnHome?.());

	const setupBtn = document.createElement("button");
	setupBtn.type = "button";
	setupBtn.className = "btn";
	setupBtn.textContent = "↺ Back to setup";
	setupBtn.addEventListener("click", () => handlers.onBackToSetup?.());

	actions.appendChild(homeBtn);
	actions.appendChild(setupBtn);
	container.appendChild(actions);

	const exportBtn = document.createElement("button");
	exportBtn.type = "button";
	exportBtn.className = "btn";
	exportBtn.style.cssText = "width:100%;margin-top:8px;";
	exportBtn.textContent = "⇩ Export nearby as .glb";
	exportBtn.addEventListener("click", () => {
		exportBtn.textContent = "Exporting…";
		// Defer so the label repaint lands before the (blocking) export.
		setTimeout(() => {
			try {
				handlers.onExport?.();
			} finally {
				exportBtn.textContent = "⇩ Export nearby as .glb";
			}
		}, 30);
	});
	container.appendChild(exportBtn);

	return {
		pane,
		dispose() {
			pane.dispose();
			container.innerHTML = "";
		},
	};
}
