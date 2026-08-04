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

		// Ground WALL containers (rings + pokes) filled, then second story inset.
		// Level-3 island containers are drawn later as their own tinted layer.
		for (const c of model.containers.filter((c) => c.story === 1 && !c.level3)) {
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

		// Level-2 half-platforms.
		ctx.fillStyle = "rgba(80,200,255,0.55)";
		for (const k of model.level2 || []) {
			const [cx, cz] = k.split(",").map(Number);
			ctx.fillRect(px(cx) + 1, py(cz) + 1, s - 2, s - 2);
		}

		// Level-3 container tops (generated islands) — purple tint over ground.
		ctx.fillStyle = "rgba(150,120,220,0.62)";
		for (const k of model.level3 || []) {
			const [cx, cz] = k.split(",").map(Number);
			ctx.fillRect(px(cx) + 1, py(cz) + 1, s - 2, s - 2);
		}

		// Bridges: teal outline + a lane line across the long sides (drive-under axis).
		ctx.strokeStyle = "#38e0c0";
		ctx.lineWidth = Math.max(1.5, s * 0.08);
		for (const c of (model.containers || []).filter((c) => c.bridge)) {
			const xs = c.cells.map((p) => p[0]);
			const zs = c.cells.map((p) => p[1]);
			const x = px(Math.min(...xs)), y = py(Math.min(...zs));
			const w = (Math.max(...xs) - Math.min(...xs) + 1) * s;
			const h = (Math.max(...zs) - Math.min(...zs) + 1) * s;
			ctx.strokeRect(x + 1.5, y + 1.5, w - 3, h - 3);
			ctx.beginPath(); // tunnel runs across the domino's long sides (cross axis)
			for (const [cx, cz] of c.cells) {
				const mx = px(cx) + s / 2, my = py(cz) + s / 2;
				if (c.orient === "H") { ctx.moveTo(mx, my - s * 0.42); ctx.lineTo(mx, my + s * 0.42); }
				else { ctx.moveTo(mx - s * 0.42, my); ctx.lineTo(mx + s * 0.42, my); }
			}
			ctx.stroke();
		}

		const DIRC = { N: [0, -1], E: [1, 0], S: [0, 1], W: [-1, 0] };

		// Ramps: triangle pointing up-slope. 1→2 yellow, 2→3 orange.
		for (const r of model.ramps || []) {
			ctx.fillStyle = r.from === 2 ? "#ff9a3d" : "#ffe14d";
			const cxp = px(r.cx) + s / 2;
			const cyp = py(r.cz) + s / 2;
			const [dxc, dyc] = DIRC[r.dir] || [0, -1];
			const apex = [cxp + dxc * s * 0.38, cyp + dyc * s * 0.38];
			const bc = [cxp - dxc * s * 0.28, cyp - dyc * s * 0.28];
			const perp = [-dyc, dxc];
			ctx.beginPath();
			ctx.moveTo(apex[0], apex[1]);
			ctx.lineTo(bc[0] + perp[0] * s * 0.28, bc[1] + perp[1] * s * 0.28);
			ctx.lineTo(bc[0] - perp[0] * s * 0.28, bc[1] - perp[1] * s * 0.28);
			ctx.closePath();
			ctx.fill();
		}

		// Metal barriers: thick red segment along the guarded cell edge.
		ctx.strokeStyle = "#ff4d4d";
		ctx.lineWidth = Math.max(2, s * 0.14);
		ctx.lineCap = "round";
		for (const b of model.barriers || []) {
			const x0 = px(b.cx), y0 = py(b.cz);
			const [dxc, dyc] = DIRC[b.dir] || [0, -1];
			// Endpoints of the edge on the (dxc,dyc) side of the cell.
			let ax, ay, bx, by;
			if (dxc !== 0) { // east / west edge (vertical segment)
				const ex = dxc > 0 ? x0 + s : x0;
				ax = ex; ay = y0; bx = ex; by = y0 + s;
			} else { // north / south edge (horizontal segment)
				const ey = dyc > 0 ? y0 + s : y0;
				ax = x0; ay = ey; bx = x0 + s; by = ey;
			}
			ctx.beginPath();
			ctx.moveTo(ax, ay);
			ctx.lineTo(bx, by);
			ctx.stroke();
		}
		ctx.lineCap = "butt";

		// Tire barriers: gray marks — straight = inset edge line, concave nook = corner
		// ring (big outer arc), convex poke = corner nub. (Ground-level autotiling.)
		const CORNER_OFF = { NE: [1, -1], SE: [1, 1], SW: [-1, 1], NW: [-1, -1] };
		ctx.strokeStyle = "#8b97a6";
		ctx.fillStyle = "#8b97a6";
		ctx.lineWidth = Math.max(1, s * 0.07);
		for (const t of model.tires || []) {
			const x0 = px(t.cx), y0 = py(t.cz);
			if (t.kind === "straight" || t.kind === "bridgebase") {
				const [dx, dy] = DIRC[t.code] || [0, -1];
				let ax, ay, bx, by;
				if (dx !== 0) { const ex = dx > 0 ? x0 + s : x0; ax = ex; ay = y0 + s * 0.15; bx = ex; by = y0 + s * 0.85; }
				else { const ey = dy > 0 ? y0 + s : y0; ax = x0 + s * 0.15; ay = ey; bx = x0 + s * 0.85; by = ey; }
				ctx.beginPath(); ctx.moveTo(ax, ay); ctx.lineTo(bx, by); ctx.stroke();
			} else {
				const [cxo, cyo] = CORNER_OFF[t.code] || [1, -1];
				const cxp = x0 + s * (cxo > 0 ? 0.8 : 0.2);
				const cyp = y0 + s * (cyo > 0 ? 0.8 : 0.2);
				if (t.kind === "convex") ctx.fillRect(cxp - s * 0.08, cyp - s * 0.08, s * 0.16, s * 0.16);
				else { ctx.beginPath(); ctx.arc(cxp, cyp, Math.max(1.5, s * 0.13), 0, Math.PI * 2); ctx.stroke(); }
			}
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
