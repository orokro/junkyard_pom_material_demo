/**
 * ============================================================================
 * craft/icons.js
 * ----------------------------------------------------------------------------
 * One-shot 3D item icons for the modals. Renders each catalog item to a small
 * PNG data URL once (a dedicated offscreen renderer) and caches it, so the
 * Recipes/Keys lists can show real item art as plain <img> without competing
 * with the live inventory overlay. Swap for the user's icon PNGs later.
 * ============================================================================
 */

import * as THREE from "three";
import { RoomEnvironment } from "three/examples/jsm/environments/RoomEnvironment.js";

/** @param {object} lib loadCraftLibrary() result @param {number} [size] */
export function initIcons(lib, size = 128) {
	const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, preserveDrawingBuffer: true });
	renderer.setSize(size, size); renderer.setPixelRatio(1); renderer.setClearColor(0x000000, 0);

	const scene = new THREE.Scene();
	scene.add(new THREE.HemisphereLight(0xffffff, 0x33343f, 1.15));
	const key = new THREE.DirectionalLight(0xffffff, 1.7); key.position.set(0.6, 1.1, 1.4); scene.add(key);
	const rim = new THREE.DirectionalLight(0x88a0ff, 0.5); rim.position.set(-0.8, 0.4, -1); scene.add(rim);
	const pmrem = new THREE.PMREMGenerator(renderer);
	scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;

	const cam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 100);
	cam.position.set(0, 0, 10);

	const cache = new Map();
	const _v = new THREE.Vector3(), _s = new THREE.Vector3();

	/** @param {string} id @returns {string} PNG data URL */
	function icon(id) {
		if (cache.has(id)) return cache.get(id);
		let url = "";
		try {
			const g = lib.bakeById(id);
			const box = new THREE.Box3().setFromObject(g);
			if (!box.isEmpty()) {
				const c = box.getCenter(_v).clone(), sz = box.getSize(_s);
				const maxd = Math.max(sz.x, sz.y, sz.z) || 1;
				g.position.sub(c);
				const pivot = new THREE.Group(); pivot.add(g);
				pivot.scale.setScalar(1.62 / maxd);
				pivot.rotation.set(-0.34, 0.62, 0);   // same friendly 3/4 tilt as the inventory
				scene.add(pivot);
				renderer.render(scene, cam);
				url = renderer.domElement.toDataURL("image/png");
				scene.remove(pivot);
			}
		} catch (e) { console.warn("[icons] failed for", id, e); }
		cache.set(id, url);
		return url;
	}
	return { icon };
}
