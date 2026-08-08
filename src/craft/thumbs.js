/**
 * ============================================================================
 * craft/thumbs.js
 * ----------------------------------------------------------------------------
 * The global ORTHOGRAPHIC item overlay. A single transparent, full-viewport
 * canvas sits above the CSS (pointer-events:none) and renders each item's real
 * 3D model synced 1:1 to its DOM tile's screen rect. The DOM tiles remain the
 * interactive, reflowing, hit-tested elements; this just paints 3D on top.
 *
 * Ortho camera maps CSS pixels -> world (screen y flipped so item +Y is up),
 * so a tile rect places + scales its model directly. Rendering is scissor-
 * clipped to the inventory scroll area so models never spill over other panels.
 *
 * Models are prepared once per item id (baked, recentered to origin, unit-
 * scaled) and cloned per visible tile; off-screen tiles are culled.
 * ============================================================================
 */

import * as THREE from "three";
import { RoomEnvironment } from "three/examples/jsm/environments/RoomEnvironment.js";
import { loadCraftLibrary } from "./three/library.js";
import { BY_ID } from "./data.js";

/** thumbnail presentation */
const cfg = { spin: true, spinSpeed: 0.5, tilt: -0.34, baseY: 0.5, fill: 0.74 };

/**
 * Boot the overlay. Resolves once the library is loaded and the loop is running.
 * @returns {Promise<{refresh:()=>void, cfg:object}>}
 */
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

	// ---- per-item templates (recentered to origin, unit-scaled) ----
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
				const pivot = new THREE.Group();
				pivot.add(g);
				pivot.userData.unit = 1 / maxd;
				out = pivot;
			}
		}
		tpl.set(id, out);
		return out;
	}

	/** @type {Map<HTMLElement, {obj:THREE.Object3D, id:string}>} */
	const objs = new Map();
	let tiles = [];
	const refresh = () => { tiles = Array.from(document.querySelectorAll(".invtile[data-item]")); };

	let W = 0, H = 0;
	function resize() {
		const w = window.innerWidth, h = window.innerHeight;
		if (w === W && h === H) return;
		W = w; H = h; renderer.setSize(W, H, false);
	}

	function frame(ms) {
		requestAnimationFrame(frame);
		resize();
		cam.left = 0; cam.right = W; cam.top = 0; cam.bottom = -H; cam.updateProjectionMatrix();
		const inv = document.querySelector("#inventory .invscroll")?.getBoundingClientRect();
		const t = ms * 0.001;

		for (const tile of tiles) {
			const r = tile.getBoundingClientRect();
			const vis = !!inv && r.bottom > inv.top && r.top < inv.bottom && r.right > 0 && r.left < W;
			let rec = objs.get(tile);
			const id = tile.dataset.item;
			if (!vis) { if (rec) rec.obj.visible = false; continue; }
			if (!rec || rec.id !== id) {
				if (rec) scene.remove(rec.obj);
				const tp = template(id);
				if (!tp) { objs.delete(tile); continue; }
				const obj = tp.clone();
				scene.add(obj);
				rec = { obj, id }; objs.set(tile, rec);
			}
			const tp = template(id);
			rec.obj.visible = true;
			rec.obj.position.set(r.left + r.width / 2, -(r.top + r.height / 2), 0);
			rec.obj.scale.setScalar(Math.min(r.width, r.height) * cfg.fill * tp.userData.unit);
			rec.obj.rotation.set(cfg.tilt, cfg.baseY + (cfg.spin ? t * cfg.spinSpeed : 0), 0);
		}

		// clear full (transparent), then draw scissor-clipped to the inventory
		renderer.setScissorTest(false);
		renderer.setViewport(0, 0, W, H);
		renderer.clear(true, true, true);
		if (inv && inv.width > 0) {
			renderer.setScissorTest(true);
			renderer.setScissor(inv.left, H - inv.bottom, inv.width, inv.height);
			renderer.render(scene, cam);
		}
	}

	refresh();
	requestAnimationFrame(frame);
	return { refresh, cfg };
}
