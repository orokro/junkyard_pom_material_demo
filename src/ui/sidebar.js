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
import { DEFAULT_POST_SHADER } from "../three/postfx.js";
import { loadPostFX, savePostFX } from "../settings.js";

/**
 * @typedef {object} SidebarHandlers
 * @property {(key: string, value: *) => void} [onChange] Fired on any binding change.
 * @property {() => void} [onReturnHome] Fired by the "Return home" button.
 * @property {() => void} [onBackToSetup] Fired by the "Back to setup" button.
 * @property {() => void} [onExport] Fired by the "Export .glb" button.
 * @property {(enabled: boolean) => void} [onPostToggle] Fired when post-FX is toggled.
 * @property {(code: string) => void} [onApplyShader] Fired to apply pasted post-FX shader.
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

	// Post-FX section: enable toggle + live-editable fragment shader.
	const post = loadPostFX();
	const postWrap = document.createElement("div");
	postWrap.style.cssText = "margin-top:12px;border-top:1px solid var(--edge);padding-top:10px;";

	const postHead = document.createElement("label");
	postHead.style.cssText = "display:flex;align-items:center;gap:8px;font-size:12px;color:var(--text);cursor:pointer;";
	const postChk = document.createElement("input");
	postChk.type = "checkbox";
	postChk.checked = post.enabled;
	postChk.style.accentColor = "var(--accent)";
	const postHeadText = document.createElement("span");
	postHeadText.textContent = "Post-processing";
	postHead.appendChild(postChk);
	postHead.appendChild(postHeadText);

	const ta = document.createElement("textarea");
	ta.value = post.code || DEFAULT_POST_SHADER;
	ta.spellcheck = false;
	ta.style.cssText =
		"width:100%;height:150px;margin-top:8px;font:11px/1.4 monospace;background:#10141b;" +
		"color:#cdd6e2;border:1px solid var(--edge);border-radius:8px;padding:8px;resize:vertical;white-space:pre;overflow:auto;";

	const btnRow = document.createElement("div");
	btnRow.style.cssText = "display:flex;gap:8px;margin-top:8px;";
	const applyBtn = document.createElement("button");
	applyBtn.type = "button";
	applyBtn.className = "btn";
	applyBtn.style.flex = "1";
	applyBtn.textContent = "Apply shader";
	const resetBtn = document.createElement("button");
	resetBtn.type = "button";
	resetBtn.className = "btn";
	resetBtn.textContent = "Reset";
	btnRow.appendChild(applyBtn);
	btnRow.appendChild(resetBtn);

	const persist = () => savePostFX({ enabled: postChk.checked, code: ta.value });
	postChk.addEventListener("change", () => {
		handlers.onPostToggle?.(postChk.checked);
		persist();
	});
	applyBtn.addEventListener("click", () => {
		handlers.onApplyShader?.(ta.value);
		persist();
	});
	resetBtn.addEventListener("click", () => {
		ta.value = DEFAULT_POST_SHADER;
		handlers.onApplyShader?.(ta.value);
		persist();
	});

	postWrap.appendChild(postHead);
	postWrap.appendChild(ta);
	postWrap.appendChild(btnRow);
	container.appendChild(postWrap);

	return {
		pane,
		dispose() {
			pane.dispose();
			container.innerHTML = "";
		},
	};
}
