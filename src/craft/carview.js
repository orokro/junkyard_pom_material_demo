/**
 * ============================================================================
 * craft/carview.js
 * ----------------------------------------------------------------------------
 * The Load Out 3D panel: a perspective scene showing the real DemoCar with an
 * orbit camera (free to go BELOW the floor to inspect the underside). Reflects
 * the current slot loadout on the model — front/rear weapons at their authored
 * transforms, and grip<->slick tire swaps. Battery/suspension are intentionally
 * not shown.
 *
 * Shares the already-loaded parts library (geometry + rebuilt materials) with
 * the thumbnail overlay — nothing is loaded twice.
 * ============================================================================
 */

import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { RoomEnvironment } from "three/examples/jsm/environments/RoomEnvironment.js";
import { BY_ID } from "./data.js";

/** @param {object} lib loadCraftLibrary() result */
export function initCarView(lib) {
	const host = document.querySelector("#loadout .carview");
	if (!host) return null;
	host.querySelectorAll("span").forEach((s) => s.remove());  // drop the "3D car view" placeholder

	const canvas = document.createElement("canvas");
	canvas.style.cssText = "position:absolute;inset:0;width:100%;height:100%;";
	host.insertBefore(canvas, host.firstChild);

	const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
	renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
	renderer.toneMapping = THREE.ACESFilmicToneMapping;
	renderer.toneMappingExposure = 1.05;
	renderer.setClearColor(0x3c4f57, 1);

	const scene = new THREE.Scene();
	const camera = new THREE.PerspectiveCamera(42, 1, 0.05, 200);
	camera.position.set(2.3, 1.3, 3.1);
	const controls = new OrbitControls(camera, canvas);
	controls.enableDamping = true; controls.dampingFactor = 0.08;
	controls.minDistance = 0.9; controls.maxDistance = 14;   // no polar clamp -> can orbit below y=0

	scene.add(new THREE.HemisphereLight(0xcfe0ff, 0x33302a, 0.85));
	const key = new THREE.DirectionalLight(0xfff2e0, 2.2); key.position.set(4, 6, 3); scene.add(key);
	const rim = new THREE.DirectionalLight(0x88aaff, 0.6); rim.position.set(-4, 3, -4); scene.add(rim);
	const pmrem = new THREE.PMREMGenerator(renderer);
	scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;

	const grid = new THREE.GridHelper(10, 20, 0x2f3d47, 0x263039);
	grid.material.transparent = true; grid.material.opacity = 0.35;
	scene.add(grid);

	// ---- car ----
	const car = lib.buildCar();
	const carRoot = new THREE.Group(); carRoot.add(car.object); scene.add(carRoot);
	const box = new THREE.Box3().setFromObject(car.object);
	const c = box.getCenter(new THREE.Vector3());
	carRoot.position.set(-c.x, -box.min.y, -c.z);
	controls.target.set(0, (box.max.y - box.min.y) * 0.45, 0);

	const mount = car.mountParent;
	const attached = { front: null, rear: null };
	const slick = new Map();

	function attachSlot(k, id) {
		if (attached[k]) { mount.remove(attached[k]); attached[k] = null; }
		if (!id) return;
		const g = lib.bakeItem(BY_ID[id]);
		const t = lib.slotTransforms[id];
		if (t) { g.position.copy(t.position); g.quaternion.copy(t.quaternion); g.scale.copy(t.scale); }
		mount.add(g); attached[k] = g;
	}
	function setWheel(i, isSlick) {
		car.object.traverse((o) => { if (o.isMesh && o.userData.wheel === "GripTire00" + i) o.visible = !isSlick; });
		const prev = slick.get(i); if (prev) { mount.remove(prev); slick.delete(i); }
		if (isSlick) {
			const g = lib.bakeItem(BY_ID.slick_tire);
			const w = car.wheelSlots.find((w) => w.index === i);
			if (w) { g.position.copy(w.position); g.quaternion.copy(w.quaternion); g.scale.copy(w.scale); }
			mount.add(g); slick.set(i, g);
		}
	}

	/** reflect slot state on the car @param {object} slots builder S.slots */
	function syncLoadout(slots) {
		attachSlot("front", slots.front?.id);
		attachSlot("rear", slots.rear?.id);
		for (let i = 1; i <= 4; i++) setWheel(i, slots.tires[i - 1]?.id === "slick_tire");
	}

	// ---- free placement (raycast onto CarPaint, oriented to the surface) ----
	const AXIS = { x: new THREE.Vector3(1, 0, 0), y: new THREE.Vector3(0, 1, 0), z: new THREE.Vector3(0, 0, 1) };
	const ray = new THREE.Raycaster();
	const ndc = new THREE.Vector2();
	const _inv = new THREE.Matrix4();
	let heldAny = false;      // builder is holding SOMETHING (blocks detach)
	let heldItem = null;      // the placeable item being positioned (or null)
	let ghostId = null, ghostObj = null;
	const placed = [];        // { id, object } free-placed weapons on the car
	let cbPlace = null, cbDetach = null;
	let downX = 0, downY = 0;

	function ndcFrom(e) {
		const r = canvas.getBoundingClientRect();
		ndc.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
	}
	function hitCar(e) { ndcFrom(e); ray.setFromCamera(ndc, camera); return ray.intersectObjects(car.carPaint, false)[0] || null; }
	function hitPlaced(e) {
		if (!placed.length) return null;
		ndcFrom(e); ray.setFromCamera(ndc, camera);
		const hits = ray.intersectObjects(placed.map((p) => p.object), true);
		if (!hits.length) return null;
		for (let o = hits[0].object; o; o = o.parent) { const p = placed.find((x) => x.object === o); if (p) return p; }
		return null;
	}
	/** local-to-mount transform for a placeable item at a CarPaint hit */
	function placeXform(hit, item) {
		mount.updateWorldMatrix(true, false);
		_inv.copy(mount.matrixWorld).invert();
		const position = hit.point.clone().applyMatrix4(_inv);
		let n = hit.face.normal.clone().transformDirection(hit.object.matrixWorld).normalize();
		if (item.upBias) n.lerp(AXIS.y, item.upBias).normalize();   // launcher tilts skyward
		n.transformDirection(_inv).normalize();
		const quaternion = new THREE.Quaternion().setFromUnitVectors(AXIS[item.outAxis] || AXIS.x, n);
		return { position, quaternion };
	}
	function makeGhost(id) {
		const g = lib.bakeById(id);
		g.traverse((o) => { if (o.isMesh) o.material = new THREE.MeshBasicMaterial({ color: 0x7ad06a, transparent: true, opacity: 0.5, depthWrite: false, depthTest: false }); });
		g.renderOrder = 999; g.visible = false;
		return g;
	}
	function commit(item, hit) {
		const g = lib.bakeById(item.id);
		const t = placeXform(hit, item);
		g.position.copy(t.position); g.quaternion.copy(t.quaternion);
		g.userData.placedId = item.id;
		mount.add(g); placed.push({ id: item.id, object: g });
	}

	/** builder tells us what's in hand; we (re)build a translucent ghost if placeable */
	function setHeld(held) {
		heldAny = !!held;
		const item = held && BY_ID[held.id];
		const placeable = item && item.mount === "place";
		const id = placeable ? item.id : null;
		heldItem = placeable ? item : null;
		if (id === ghostId) return;             // same ghost — keep it
		if (ghostObj) { scene.remove(ghostObj); ghostObj = null; }
		ghostId = id;
		if (id) { ghostObj = makeGhost(id); scene.add(ghostObj); }
	}
	function setCallbacks(cb) { cbPlace = cb?.onPlace || null; cbDetach = cb?.onDetach || null; }

	canvas.addEventListener("pointerdown", (e) => { downX = e.clientX; downY = e.clientY; });
	canvas.addEventListener("pointermove", (e) => {
		if (!heldItem || !ghostObj) return;
		const hit = hitCar(e);
		if (hit) { const t = placeXform(hit, heldItem); ghostObj.position.copy(t.position); ghostObj.quaternion.copy(t.quaternion); ghostObj.visible = true; }
		else ghostObj.visible = false;
	});
	canvas.addEventListener("pointerleave", () => { if (ghostObj) ghostObj.visible = false; });
	canvas.addEventListener("pointerup", (e) => {
		if (Math.hypot(e.clientX - downX, e.clientY - downY) > 6) return;   // was an orbit/pan drag
		if (heldItem) { const hit = hitCar(e); if (hit) { commit(heldItem, hit); cbPlace && cbPlace(heldItem.id); } }
		else if (!heldAny) { const p = hitPlaced(e); if (p) { mount.remove(p.object); placed.splice(placed.indexOf(p), 1); cbDetach && cbDetach(p.id); } }
	});

	function resize() { const w = host.clientWidth, h = host.clientHeight; if (!w || !h) return; renderer.setSize(w, h, false); camera.aspect = w / h; camera.updateProjectionMatrix(); }
	new ResizeObserver(resize).observe(host); resize();
	(function tick() { requestAnimationFrame(tick); controls.update(); renderer.render(scene, camera); })();

	return { syncLoadout, setHeld, setCallbacks, scene, car, camera, controls, placed };
}
