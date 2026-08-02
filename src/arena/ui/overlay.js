/**
 * ============================================================================
 * arena/ui/overlay.js
 * ----------------------------------------------------------------------------
 * Debug top-down schematic of the generated arena, drawn to a 2D canvas overlay
 * (toggled from the Tweakpane sidebar). Lets us validate the generation logic
 * without trusting the 3D build.
 *
 * Phase 5 draws: in-bounds rectangle, ring/poke containers (filled by color;
 * second-story shown as an inset outline), and chairs as dots. Later phases add
 * level-2/3 islands, ramps, bridges, tires, and barriers.
 * ============================================================================
 */

import { CELL } from "../gen/grid.js";

const COLOR_HEX = { Blue: "#4a90e2", Red: "#e2574a", White: "#dfe6ee", Green: "#4ac47a" };
const SIZE = 320; // canvas px (square)
const PAD = 10;

/**
 * @typedef {object} Overlay
 * @property {(model: import("../gen/arena.js").ArenaModel) => void} update
 * @property {(on: boolean) => void} setVisible
 * @property {() => void} dispose
 */

/**
 * Create the overlay canvas inside a host element.
 * @param {HTMLElement} host  Usually #app.
 * @returns {Overlay}
 */
export function createOverlay(host) {
	const canvas = document.createElement("canvas");
	canvas.width = SIZE;
	canvas.height = SIZE;
	canvas.className = "arena-overlay hidden";
	canvas.style.cssText =
		"position:absolute;left:14px;bottom:14px;width:320px;height:320px;z-index:30;" +
		"background:rgba(10,13,18,0.82);border:1px solid #2b3441;border-radius:12px;" +
		"backdrop-filter:blur(8px);image-rendering:crisp-edges;";
	host.appendChild(canvas);
	const ctx = /** @type {CanvasRenderingContext2D} */ (canvas.getContext("2d"));

	/**
	 * @param {import("../gen/arena.js").ArenaModel} model
	 * @returns {void}
	 */
	function update(model) {
		// Domain extents (cells) from containers + in-bounds.
		let minCx = 0, minCz = 0, maxCx = model.dims.Wc - 1, maxCz = model.dims.Dc - 1;
		for (const c of model.containers) {
			for (const [x, z] of c.cells) {
				minCx = Math.min(minCx, x); minCz = Math.min(minCz, z);
				maxCx = Math.max(maxCx, x); maxCz = Math.max(maxCz, z);
			}
		}
		const spanX = maxCx - minCx + 1;
		const spanZ = maxCz - minCz + 1;
		const s = Math.min((SIZE - 2 * PAD) / spanX, (SIZE - 2 * PAD) / spanZ);
		// Cell (cx,cz) → canvas px. North (−Z) at top: invert Z.
		const px = (cx) => PAD + (cx - minCx) * s;
		const py = (cz) => PAD + (cz - minCz) * s;

		ctx.clearRect(0, 0, SIZE, SIZE);

		// In-bounds rectangle.
		ctx.fillStyle = "rgba(120,140,160,0.10)";
		ctx.fillRect(px(0), py(0), model.dims.Wc * s, model.dims.Dc * s);
		ctx.strokeStyle = "#ffd23d";
		ctx.lineWidth = 1.5;
		ctx.strokeRect(px(0), py(0), model.dims.Wc * s, model.dims.Dc * s);

		// Ground containers (filled) then second story (inset outline).
		for (const c of model.containers.filter((c) => c.story === 1)) {
			drawDomino(c, "fill");
		}
		for (const c of model.containers.filter((c) => c.story === 2)) {
			drawDomino(c, "inset");
		}

		// Chairs.
		ctx.fillStyle = "#ffb060";
		for (const ch of model.chairs) {
			const cx = ch.pos[0] / CELL;
			const cz = ch.pos[2] / CELL;
			ctx.beginPath();
			ctx.arc(PAD + (cx - minCx) * s, PAD + (cz - minCz) * s, Math.max(1.5, s * 0.12), 0, Math.PI * 2);
			ctx.fill();
		}

		// Legend.
		ctx.fillStyle = "#93a1b3";
		ctx.font = "10px monospace";
		ctx.fillText(`${model.seed}  ${model.dims.Wc}x${model.dims.Dc}  r=${model.ratio.toFixed(2)}`, PAD, SIZE - 4);

		/** @param {import("../gen/rings.js").Container} c @param {"fill"|"inset"} mode */
		function drawDomino(c, mode) {
			const xs = c.cells.map((p) => p[0]);
			const zs = c.cells.map((p) => p[1]);
			const x = px(Math.min(...xs));
			const y = py(Math.min(...zs));
			const w = (Math.max(...xs) - Math.min(...xs) + 1) * s;
			const h = (Math.max(...zs) - Math.min(...zs) + 1) * s;
			if (mode === "fill") {
				ctx.fillStyle = COLOR_HEX[c.color] || "#888";
				ctx.globalAlpha = c.ring ? 0.9 : 0.55; // pokes slightly dimmer
				ctx.fillRect(x + 0.5, y + 0.5, w - 1, h - 1);
				ctx.globalAlpha = 1;
				ctx.strokeStyle = "rgba(0,0,0,0.4)";
				ctx.lineWidth = 0.5;
				ctx.strokeRect(x + 0.5, y + 0.5, w - 1, h - 1);
			} else {
				ctx.strokeStyle = "#0a0d12";
				ctx.lineWidth = 1;
				const in2 = Math.max(1.5, s * 0.18);
				ctx.strokeRect(x + in2, y + in2, w - 2 * in2, h - 2 * in2);
			}
		}
	}

	return {
		update,
		setVisible(on) {
			canvas.classList.toggle("hidden", !on);
		},
		dispose() {
			canvas.remove();
		},
	};
}
