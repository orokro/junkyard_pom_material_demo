/**
 * ============================================================================
 * craft/three/garage.js
 * ----------------------------------------------------------------------------
 * The interactive car-builder: holds the DemoCar, attaches/detaches items, and
 * implements the placement rules —
 *   - fixed front/back slots (authored transform),
 *   - grip<->slick wheel swap,
 *   - raycast-to-normal placement on the CarPaint surface (+ launcher up-bias),
 *   - hand-type sockets on placed pipes/springs/hydraulics/scorpion,
 *   - left-side hand mirroring (geometry flip, winding + normals corrected).
 * Weight is the sum of attached item weights (drives handling later).
 * ============================================================================
 */

import * as THREE from "three";
import { BY_ID } from "../data.js";

/**
 * @param {object} scene three scene bundle
 * @param {object} lib   loadCraftLibrary() result
 * @returns {object} garage API
 */
export function createGarage(scene, lib) {
	const car = lib.buildCar();
	const carRoot = new THREE.Group();
	carRoot.add(car.object);
	scene.scene.add(carRoot);

	// Center the car over the origin.
	const box = new THREE.Box3().setFromObject(car.object);
	const c = box.getCenter(new THREE.Vector3());
	carRoot.position.set(-c.x, -box.min.y, -c.z);
	scene.controls.target.set(0, (box.max.y - box.min.y) * 0.45, 0);

	const mount = car.mountParent;
	const raycaster = new THREE.Raycaster();

	/** @type {{front:?object, back:?object, battery:?object}} */
	const slots = { front: null, back: null, battery: null };
	/** @type {Array<object>} placed normal-mount items */
	const placed = [];
	/** wheel slot -> current tire id */
	const wheelState = new Map(car.wheelSlots.map((w) => [w.index, "grip_tire"]));
	const wheelSlickObjs = new Map();

	const handCache = { right: {}, left: {} };
	let pending = null;   // { item, mode:"normal"|"hand" }
	let onChange = () => {};

	/** Mirror a group's geometry across local X (keeps normals correct). */
	function mirrorX(group) {
		group.traverse((o) => {
			if (!o.isMesh) return;
			const g = o.geometry;
			const p = g.attributes.position; for (let i = 0; i < p.count; i++) p.setX(i, -p.getX(i)); p.needsUpdate = true;
			const n = g.attributes.normal; if (n) { for (let i = 0; i < n.count; i++) n.setX(i, -n.getX(i)); n.needsUpdate = true; }
			if (g.index) { const a = g.index.array; for (let i = 0; i < a.length; i += 3) { const t = a[i + 1]; a[i + 1] = a[i + 2]; a[i + 2] = t; } g.index.needsUpdate = true; }
		});
		return group;
	}

	const AXIS = { x: new THREE.Vector3(1, 0, 0), y: new THREE.Vector3(0, 1, 0), z: new THREE.Vector3(0, 0, 1) };

	/** Attach a fixed front/back/battery item at its authored transform. */
	function attachFixed(item) {
		const key = item.mount;
		if (slots[key]) { mount.remove(slots[key].object); }
		const g = lib.bakeItem(item);
		const t = lib.slotTransforms[item.id];
		if (t) { g.position.copy(t.position); g.quaternion.copy(t.quaternion); g.scale.copy(t.scale); }
		else if (key === "battery") { g.position.set(0, 0.35, 0.35); } // placeholder battery-box spot
		mount.add(g);
		slots[key] = { item, object: g };
		onChange();
	}

	/** Toggle a wheel slot between grip and slick. */
	function setWheel(index, tireId) {
		const slot = car.wheelSlots.find((w) => w.index === index);
		if (!slot) return;
		// hide the authored grip mesh(es) for this slot
		car.object.traverse((o) => { if (o.isMesh && o.userData.wheel === "GripTire00" + index) o.visible = tireId === "grip_tire"; });
		const prev = wheelSlickObjs.get(index);
		if (prev) { mount.remove(prev); wheelSlickObjs.delete(index); }
		if (tireId === "slick_tire") {
			const g = lib.bakeItem(BY_ID.slick_tire);
			g.position.copy(slot.position); g.quaternion.copy(slot.quaternion); g.scale.copy(slot.scale);
			mount.add(g); wheelSlickObjs.set(index, g);
		}
		wheelState.set(index, tireId);
		onChange();
	}

	/** Begin placement / socket mode for an item selected from inventory. */
	function begin(item) {
		if (item.mount === "front" || item.mount === "back" || item.mount === "battery") { attachFixed(item); return "attached"; }
		scene.controls.enabled = false; // orbit off while picking a target
		if (item.mount === "wheel") { pending = { item, mode: "wheel" }; return "pick-wheel"; }
		if (item.mount === "hand") { pending = { item, mode: "hand" }; refreshSocketMarkers(); return "pick-socket"; }
		pending = { item, mode: "normal" }; return "place";
	}

	/** Handle a click in the 3D view given normalized device coords. */
	function click(ndc) {
		if (!pending) return null;
		raycaster.setFromCamera(ndc, scene.camera);
		let res = null;
		if (pending.mode === "normal") res = placeNormal();
		else if (pending.mode === "wheel") res = clickWheel();
		else if (pending.mode === "hand") res = clickSocket();
		if (!pending) scene.controls.enabled = true; // re-enable orbit once resolved
		return res;
	}

	function placeNormal() {
		const hits = raycaster.intersectObjects(car.carPaint, false);
		if (!hits.length) return null;
		const hit = hits[0];
		const item = pending.item;
		const localPos = mount.worldToLocal(hit.point.clone());
		// world normal -> mount-local direction
		const nWorld = hit.face.normal.clone().transformDirection(hit.object.matrixWorld);
		let nLocal = nWorld.clone().transformDirection(new THREE.Matrix4().copy(mount.matrixWorld).invert()).normalize();
		if (item.upBias) {
			const up = new THREE.Vector3(0, 1, 0);
			nLocal = nLocal.lerp(up, item.upBias).normalize();
		}
		const g = lib.bakeItem(item);
		g.position.copy(localPos);
		g.quaternion.copy(new THREE.Quaternion().setFromUnitVectors(AXIS[item.outAxis || "x"], nLocal));
		mount.add(g);
		const rec = { item, object: g, sockets: [] };
		if (item.socket) rec.socketWorld = computeSocketWorld(item, g);
		placed.push(rec);
		pending = null;
		onChange();
		return "placed";
	}

	function clickWheel() {
		// pick nearest wheel slot to the ray
		const hits = raycaster.intersectObject(car.object, true);
		if (!hits.length) return null;
		const p = mount.worldToLocal(hits[0].point.clone());
		let best = null, bd = Infinity;
		for (const w of car.wheelSlots) { const d = p.distanceTo(w.position); if (d < bd) { bd = d; best = w; } }
		if (best) setWheel(best.index, pending.item.id);
		pending = null;
		return "wheel";
	}

	/** Compute a placed socket item's socket world matrix (for hand attach + markers). */
	function computeSocketWorld(item, obj, variant = "default") {
		const s = lib.sockets[item.id];
		const m = s && (s[variant] || s.default || s.fist || s.slap);
		if (!m) return null;
		obj.updateWorldMatrix(true, false);
		return new THREE.Matrix4().multiplyMatrices(obj.matrixWorld, m);
	}

	// socket markers (clickable spheres)
	const markerGroup = new THREE.Group(); scene.scene.add(markerGroup);
	function refreshSocketMarkers() {
		markerGroup.clear();
		for (const rec of placed) {
			if (!rec.item.socket || rec.hand) continue;
			const wm = rec.socketWorld || computeSocketWorld(rec.item, rec.object);
			if (!wm) continue;
			const pos = new THREE.Vector3().setFromMatrixPosition(wm);
			const dot = new THREE.Mesh(new THREE.SphereGeometry(0.03, 12, 12), new THREE.MeshBasicMaterial({ color: 0x66ff88 }));
			dot.position.copy(pos); dot.userData.rec = rec; markerGroup.add(dot);
		}
	}
	function clearMarkers() { markerGroup.clear(); }

	function clickSocket() {
		const hits = raycaster.intersectObjects(markerGroup.children, false);
		if (!hits.length) { pending = null; clearMarkers(); return null; }
		const rec = hits[0].object.userData.rec;
		const handItem = pending.item;
		// pick socket variant (elbow differs per hand type)
		const variant = lib.sockets[rec.item.id]?.[handItem.id === "fist" ? "fist" : "slap"] ? (handItem.id === "fist" ? "fist" : "slap") : "default";
		const localSocket = lib.sockets[rec.item.id]?.[variant] || lib.sockets[rec.item.id]?.default;
		// mirror if socket sits on car's -X side
		const worldPos = new THREE.Vector3().setFromMatrixPosition(rec.socketWorld || computeSocketWorld(rec.item, rec.object, variant));
		const side = mount.worldToLocal(worldPos.clone()).x < 0 ? "left" : "right";
		let hand = handCache[side][handItem.id];
		if (!hand) { hand = lib.bakeItem(handItem); if (side === "left") mirrorX(hand); handCache[side][handItem.id] = hand; }
		const inst = hand.clone();
		inst.applyMatrix4(localSocket);
		rec.object.add(inst);
		rec.hand = inst;
		pending = null; clearMarkers();
		onChange();
		return "handed";
	}

	function totalWeight() {
		let w = 0;
		for (const k of Object.keys(slots)) if (slots[k]) w += slots[k].item.weight || 0;
		for (const r of placed) { w += r.item.weight || 0; if (r.hand) w += 1; }
		for (const [i, id] of wheelState) w += (BY_ID[id]?.weight || 0);
		return w;
	}

	function clearAll() {
		for (const k of Object.keys(slots)) if (slots[k]) { mount.remove(slots[k].object); slots[k] = null; }
		for (const r of placed) mount.remove(r.object); placed.length = 0;
		for (const [i] of wheelState) setWheel(i, "grip_tire");
		clearMarkers(); pending = null; onChange();
	}

	return {
		carRoot, slots, placed,
		begin, click, attachFixed, setWheel, clearAll,
		cancel() { pending = null; clearMarkers(); scene.controls.enabled = true; },
		isPending: () => !!pending,
		pendingItem: () => pending?.item || null,
		weight: totalWeight,
		setOnChange(fn) { onChange = fn; },
	};
}
