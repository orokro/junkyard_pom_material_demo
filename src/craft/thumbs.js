/**
 * ============================================================================
 * craft/thumbs.js
 * ----------------------------------------------------------------------------
 * The global ORTHOGRAPHIC item overlay. A single transparent, full-viewport
 * canvas above the CSS (pointer-events:none) renders each item's real 3D model
 * synced 1:1 to its DOM tile's rect. The DOM tiles stay the interactive,
 * reflowing, hit-tested elements; this paints 3D on top.
 *
 * Two render passes so scrolling and fixed panels both work:
 *   pass 1 - inventory tiles, scissor-clipped to the scroll area,
 *   pass 2 - slots/crafting tiles + the drag ghost, full-viewport.
 *
 * Any element with [data-item] is a tile. The exported `ghost` object lets the
 * drag system float a held item under the cursor.
 * ============================================================================
 */

import * as THREE from "three";
import { RoomEnvironment } from "three/examples/jsm/environments/RoomEnvironment.js";
import { loadCraftLibrary } from "./three/library.js";
import { BY_ID } from "./data.js";

const cfg = { spin: true, spinSpeed: 0.5, tilt: -0.34, baseY: 0.5, fill: 0.74 };
/** Drag ghost: set id to float a held item at (x,y) screen px; null to hide. */
export const ghost = { id: null, x: 0, y: 0 };

export async function initThumbs() {
	const canvas = /** @type {HTMLCanvasElement} */ (document.getElementById("overlay"));
	const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
	renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
	renderer.setClearColor(0x000000, 0);
	renderer.autoClear = false;

	const scene = new THREE.Scene();
	const cam = new THREE.OrthographicCamera(0, 1, 0, -1, 1, 6000);
	cam.position.set(0, 0, 2500);
	scene.add(new THREE.HemisphereLight(0xffffff, 0x33343f, 1.15));
	const key = new THREE.DirectionalLight(0xffffff, 1.7); key.position.set(0.6, 1.1, 1.4); scene.add(key);
	const rim = new THREE.DirectionalLight(0x88a0ff, 0.5); rim.position.set(-0.8, 0.4, -1); scene.add(rim);
	const pmrem = new THREE.PMREMGenerator(renderer);
	scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;

	const lib = await loadCraftLibrary(renderer);

	const tpl = new Map();
	const _v = new THREE.Vector3(), _s = new THREE.Vector3();
	function template(id) {
		if (tpl.has(id)) return tpl.get(id);
		const item = BY_ID[id];
		let out = null;
		if (item) {
			const g = lib.bakeItem(item);
			const box = new THREE.Box3().setFromObject(g);
			if (!box.isEmpty()) {
				const c = box.getCenter(_v).clone(), size = box.getSize(_s);
				const maxd = Math.max(size.x, size.y, size.z) || 1;
				g.position.sub(c);
				const pivot = new THREE.Group(); pivot.add(g); pivot.userData.unit = 1 / maxd;
				out = pivot;
			}
		}
		tpl.set(id, out);
		return out;
	}

	/** @type {Map<HTMLElement,{obj:THREE.Object3D,id:string,scope:string,vis:boolean}>} */
	const objs = new Map();
	let invTiles = [], fixedTiles = [];
	const refresh = () => {
		invTiles = Array.from(document.querySelectorAll("#inventory [data-item]"));
		fixedTiles = Array.from(document.querySelectorAll("#slots [data-item], #crafting [data-item]"));
	};

	let ghostObj = null, ghostId = null, W = 0, H = 0, _t = 0;
	function resize() { const w = innerWidth, h = innerHeight; if (w === W && h === H) return; W = w; H = h; renderer.setSize(W, H, false); }

	function sync(tile, clip, scope) {
		const r = tile.getBoundingClientRect();
		const vis = r.right > 0 && r.left < W && r.bottom > 0 && r.top < H && (!clip || (r.bottom > clip.top && r.top < clip.bottom));
		let rec = objs.get(tile); const id = tile.dataset.item;
		if (!vis) { if (rec) { rec.obj.visible = false; rec.vis = false; } return; }
		if (!rec || rec.id !== id) {
			if (rec) scene.remove(rec.obj);
			const tp = template(id); if (!tp) { objs.delete(tile); return; }
			rec = { obj: tp.clone(), id, scope, vis: true }; scene.add(rec.obj); objs.set(tile, rec);
		}
		rec.scope = scope; rec.vis = true;
		const tp = template(id);
		rec.obj.position.set(r.left + r.width / 2, -(r.top + r.height / 2), 0);
		rec.obj.scale.setScalar(Math.min(r.width, r.height) * cfg.fill * tp.userData.unit);
		rec.obj.rotation.set(cfg.tilt, cfg.baseY + (cfg.spin ? _t * cfg.spinSpeed : 0), 0);
	}

	function frame(ms) {
		requestAnimationFrame(frame);
		resize();
		_t = ms * 0.001;
		cam.left = 0; cam.right = W; cam.top = 0; cam.bottom = -H; cam.updateProjectionMatrix();
		const inv = document.querySelector("#inventory .invscroll")?.getBoundingClientRect();

		// prune tiles no longer in the DOM
		for (const [tile, rec] of objs) if (!tile.isConnected) { scene.remove(rec.obj); objs.delete(tile); }
		for (const t of invTiles) if (t.isConnected) sync(t, inv, "inv");
		for (const t of fixedTiles) if (t.isConnected) sync(t, null, "fixed");

		// ghost
		if (ghost.id) {
			if (ghostId !== ghost.id) { if (ghostObj) scene.remove(ghostObj); const tp = template(ghost.id); ghostObj = tp ? tp.clone() : null; if (ghostObj) scene.add(ghostObj); ghostId = ghost.id; }
			if (ghostObj) {
				const rem = parseFloat(getComputedStyle(document.documentElement).fontSize) || 16;
				const px = 4.4 * rem, tp = template(ghost.id);
				ghostObj.position.set(ghost.x, -ghost.y, 0);
				ghostObj.scale.setScalar(px * cfg.fill * tp.userData.unit);
				ghostObj.rotation.set(cfg.tilt, cfg.baseY + _t * cfg.spinSpeed, 0);
			}
		}

		// render: pass1 inventory (scissor), pass2 fixed + ghost (no scissor)
		renderer.setScissorTest(false); renderer.setViewport(0, 0, W, H); renderer.clear(true, true, true);
		for (const [, rec] of objs) rec.obj.visible = rec.scope === "inv" && rec.vis;
		if (ghostObj) ghostObj.visible = false;
		if (inv && inv.width > 0) { renderer.setScissorTest(true); renderer.setScissor(inv.left, H - inv.bottom, inv.width, inv.height); renderer.render(scene, cam); }
		for (const [, rec] of objs) rec.obj.visible = rec.scope === "fixed" && rec.vis;
		if (ghostObj) ghostObj.visible = !!ghost.id;
		renderer.setScissorTest(false); renderer.render(scene, cam);
	}

	refresh();
	requestAnimationFrame(frame);
	return { refresh, cfg, lib };  // lib shared with the car view
}
