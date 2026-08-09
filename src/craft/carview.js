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
import { onPlaceChange } from "./placement.js";
import { makeRigAnimator } from "./animation.js";

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
		if (attached[k]) { dropObject(attached[k]); attached[k] = null; }   // also unregisters any rig
		if (!id) return;
		let g, rig = null;
		if (lib.rigType && lib.rigType(id)) { rig = lib.bakeRig(id); g = rig.group; }   // e.g. scorpion tail
		else g = lib.bakeById(id);                                     // handles static composites
		const t = lib.slotTransforms[id] || lib.slotTransforms[BY_ID[id]?.composite?.base];
		if (t) { g.position.copy(t.position); g.quaternion.copy(t.quaternion); g.scale.copy(t.scale); }
		g.userData.slot = { key: k, id };                              // clickable to detach in 3D
		if (rig) { g.userData.rig = rig; animator.add(rig); }
		mount.add(g); attached[k] = g;
	}
	function setWheel(i, isSlick) {
		car.object.traverse((o) => { if (o.isMesh && o.userData.wheel === "GripTire00" + i) o.visible = !isSlick; });
		const prev = slick.get(i); if (prev) { mount.remove(prev); slick.delete(i); }
		if (isSlick) {
			const g = lib.bakeItem(BY_ID.slick_tire);
			const w = car.wheelSlots.find((w) => w.index === i);
			if (w) { g.position.copy(w.position); g.quaternion.copy(w.quaternion); g.scale.copy(w.scale); }
			g.userData.slot = { key: "tires", index: CELL_TO_WHEEL.indexOf(i), id: "slick_tire" };
			mount.add(g); slick.set(i, g);
		}
	}

	// Slot grid cells are TL,TR,BL,BR; the GLB wheels had L/R reversed within each row,
	// so top-left drove the front-RIGHT tire. Swap columns to make the grid match the car.
	const CELL_TO_WHEEL = [2, 1, 4, 3];
	/** reflect slot state on the car @param {object} slots builder S.slots */
	function syncLoadout(slots) {
		attachSlot("front", slots.front?.id);
		attachSlot("rear", slots.rear?.id);
		for (let c = 0; c < 4; c++) setWheel(CELL_TO_WHEEL[c], slots.tires[c]?.id === "slick_tire");
	}

	// ---- free placement (raycast onto CarPaint, oriented to the surface) ----
	const AXIS = { x: new THREE.Vector3(1, 0, 0), y: new THREE.Vector3(0, 1, 0), z: new THREE.Vector3(0, 0, 1) };
	const ray = new THREE.Raycaster();
	const ndc = new THREE.Vector2();
	const _inv = new THREE.Matrix4();
	let heldAny = false;         // builder is holding SOMETHING (blocks detach)
	let heldItem = null;         // the placeable item being positioned (or null)
	let ghostId = null, ghostObj = null;
	let placeRoll = 0;           // mouse-wheel roll about the surface normal
	let lastHit = null;          // last CarPaint hit (for wheel-driven re-orient)
	const placed = [];           // { id, object, matrix }
	let cbPlace = null, cbDetach = null, cbDetachSlot = null;
	let downX = 0, downY = 0;
	const REFLECT_X = new THREE.Matrix4().makeScale(-1, 1, 1);   // mirror across the car centreline
	const _one = new THREE.Vector3(1, 1, 1);

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
	/** raycast the static slot-attached weapons (front/rear/slick tires); returns their {key,index,id} */
	function hitSlot(e) {
		const objs = [attached.front, attached.rear, ...slick.values()].filter(Boolean);
		if (!objs.length) return null;
		ndcFrom(e); ray.setFromCamera(ndc, camera);
		const hits = ray.intersectObjects(objs, true);
		if (!hits.length) return null;
		for (let o = hits[0].object; o; o = o.parent) if (o.userData && o.userData.slot) return o.userData.slot;
		return null;
	}
	/**
	 * mount-local placement MATRIX for an item at a CarPaint hit. The left side is
	 * built as an exact reflection of the right (compute the transform for the
	 * mirrored hit, then reflect across the car centreline) so both sides are true
	 * mirror images — a right hand becomes a left hand automatically, no per-hand
	 * mirror bake needed. outSign flips the out-facing end; upBias tilts skyward;
	 * roll spins about the surface normal (mouse wheel).
	 */
	function placeMatrix(hit, item, roll) {
		mount.updateWorldMatrix(true, false);
		_inv.copy(mount.matrixWorld).invert();
		const p = hit.point.clone().applyMatrix4(_inv);
		let n = hit.face.normal.clone().transformDirection(hit.object.matrixWorld).normalize();
		if (item.upBias) n.lerp(AXIS.y, item.upBias).normalize();   // launcher tilts skyward
		n.transformDirection(_inv).normalize();                      // -> mount-local
		const left = p.x < 0;
		if (left) { p.x *= -1; n.x *= -1; }                          // solve on the right
		const axis = (AXIS[item.outAxis] || AXIS.x).clone();
		if (item.outSign && item.outSign < 0) axis.negate();
		const q = new THREE.Quaternion().setFromUnitVectors(axis, n);
		if (roll) q.premultiply(new THREE.Quaternion().setFromAxisAngle(n, roll * (left ? -1 : 1)));
		const m = new THREE.Matrix4().compose(p, q, _one);
		if (left) m.premultiply(REFLECT_X);                          // reflect back onto the left
		return m;
	}
	const animator = makeRigAnimator();
	function ghostMat() { return new THREE.MeshBasicMaterial({ color: 0x7ad06a, transparent: true, opacity: 0.5, depthWrite: false, depthTest: false }); }
	/** wrap a baked item so we can drive it by a raw matrix while it keeps its own family scale.
	 *  Committed animatable weapons bake a LIVE rig (registered with the animator); ghosts stay static. */
	function makeWrap(id, ghost) {
		let g, rig = null;
		if (!ghost && lib.rigType && lib.rigType(id)) { rig = lib.bakeRig(id); g = rig.group; }
		else { g = lib.bakeById(id); if (ghost) { g.traverse((o) => { if (o.isMesh) o.material = ghostMat(); }); g.renderOrder = 999; } }
		const w = new THREE.Group(); w.matrixAutoUpdate = false; w.add(g);
		if (rig) { w.userData.rig = rig; animator.add(rig); }
		return w;
	}
	/** remove a placed object's rig (if any) from the animator before dropping the object */
	function dropObject(obj) { if (obj?.userData?.rig) animator.remove(obj.userData.rig); mount.remove(obj); }
	function setMatrix(obj, m) { obj.matrix.copy(m); obj.matrixWorldNeedsUpdate = true; }
	function poseGhost(hit) { setMatrix(ghostObj, placeMatrix(hit, heldItem, placeRoll)); ghostObj.visible = true; }
	function commit(item, hit) {
		const m = placeMatrix(hit, item, placeRoll);
		const w = makeWrap(item.id, false);
		setMatrix(w, m); w.userData.placedId = item.id;
		mount.add(w);
		placed.push({ id: item.id, object: w, matrix: m.clone() });
	}
	/** re-bake ghost + every placed item (e.g. after a family-scale slider change) */
	function rebuildAll() {
		for (const p of placed) {
			dropObject(p.object);
			p.object = makeWrap(p.id, false); setMatrix(p.object, p.matrix); p.object.userData.placedId = p.id;
			mount.add(p.object);
		}
		if (heldItem && ghostObj) {
			const vis = ghostObj.visible, m = ghostObj.matrix.clone();
			scene.remove(ghostObj); ghostObj = makeWrap(heldItem.id, true); setMatrix(ghostObj, m); ghostObj.visible = vis; scene.add(ghostObj);
		}
	}
	onPlaceChange(rebuildAll);

	/** builder tells us what's in hand; we (re)build a translucent ghost if placeable */
	function setHeld(held) {
		heldAny = !!held;
		const item = held && BY_ID[held.id];
		const placeable = item && item.mount === "place";
		const id = placeable ? item.id : null;
		heldItem = placeable ? item : null;
		if (id === ghostId) return;             // same ghost — keep it
		if (ghostObj) { scene.remove(ghostObj); ghostObj = null; }
		ghostId = id; placeRoll = 0;
		if (id) { ghostObj = makeWrap(id, true); ghostObj.visible = false; scene.add(ghostObj); }
	}
	function setCallbacks(cb) { cbPlace = cb?.onPlace || null; cbDetach = cb?.onDetach || null; cbDetachSlot = cb?.onDetachSlot || null; }

	// ---- detach hover hint (mirrors the builder's cursor label) ----
	const hint = document.createElement("div"); hint.id = "detachhint"; hint.style.display = "none"; document.body.appendChild(hint);
	function showHint(x, y) { hint.textContent = "Click to detach"; hint.style.left = (x + 15) + "px"; hint.style.top = (y + 18) + "px"; hint.style.display = "block"; }
	function hideHint() { hint.style.display = "none"; }

	canvas.addEventListener("pointerdown", (e) => { downX = e.clientX; downY = e.clientY; });
	canvas.addEventListener("pointermove", (e) => {
		if (heldItem && ghostObj) {
			const hit = hitCar(e); lastHit = hit;
			if (hit) poseGhost(hit); else ghostObj.visible = false;
			hideHint();
		} else if (!heldAny) {
			const p = hitPlaced(e) || hitSlot(e);
			if (p) showHint(e.clientX, e.clientY); else hideHint();
		}
	});
	canvas.addEventListener("pointerleave", () => { if (ghostObj) ghostObj.visible = false; hideHint(); });
	canvas.addEventListener("wheel", (e) => {
		if (!heldItem) return;
		e.preventDefault();
		placeRoll += (e.deltaY > 0 ? 1 : -1) * (Math.PI / 12);   // 15° steps
		if (lastHit) poseGhost(lastHit);
	}, { passive: false });
	canvas.addEventListener("pointerup", (e) => {
		if (Math.hypot(e.clientX - downX, e.clientY - downY) > 6) return;   // was an orbit/pan drag
		if (heldItem) { const hit = hitCar(e); if (hit) { commit(heldItem, hit); cbPlace && cbPlace(heldItem.id); } return; }
		if (heldAny) return;
		const p = hitPlaced(e);
		if (p) { dropObject(p.object); placed.splice(placed.indexOf(p), 1); hideHint(); cbDetach && cbDetach(p.id); return; }
		const sl = hitSlot(e);                                   // static slot weapon -> detach into hand
		if (sl) { hideHint(); cbDetachSlot && cbDetachSlot(sl.key, sl.index); }
	});

	// ---- CarPaint throb while a placeable is in hand (signals a drop target) ----
	const paintMats = [...new Set(car.carPaint.map((m) => m.material))];
	const baseEmissive = paintMats.map((m) => m.emissive.clone());
	const throbColor = new THREE.Color(0xff741b);

	function resize() { const w = host.clientWidth, h = host.clientHeight; if (!w || !h) return; renderer.setSize(w, h, false); camera.aspect = w / h; camera.updateProjectionMatrix(); }
	new ResizeObserver(resize).observe(host); resize();
	let _t = 0, _last = 0;
	(function tick() {
		requestAnimationFrame(tick); controls.update();
		const now = performance.now();
		const dt = _last ? Math.min(0.05, (now - _last) / 1000) : 0.016; _last = now;
		animator.update(dt);                               // drive live weapon rigs
		_t += 0.05;
		const on = !!heldItem, pulse = on ? 0.28 + 0.22 * Math.sin(_t * 2.2) : 0;
		paintMats.forEach((m, i) => { m.emissive.copy(baseEmissive[i]).lerp(throbColor, pulse); });
		renderer.render(scene, camera);
	})();

	/** fire the one-shot animation for a placed/slot object's rig (non-interruptible) */
	function fireAnim(object) { return object?.userData?.rig ? animator.fire(object.userData.rig) : false; }
	function _poseRig(object, f) { const rig = object?.userData?.rig; if (rig) animator.pose(rig, f); }   // test hook
	function _armTest(object, ex, ey, ez) { const rig = object?.userData?.rig; if (rig) animator.poseArmRaw(rig, ex, ey, ez); }

	// ---- feature anchors (for the Keys modal's 2D labels) ----
	const _box = new THREE.Box3(), _c = new THREE.Vector3();
	/** project an object's top-centre to client px; visible=false if behind camera / off-panel */
	function projectTop(obj) {
		camera.updateMatrixWorld(true); obj.updateWorldMatrix(true, false);
		_box.setFromObject(obj); if (_box.isEmpty()) return { x: 0, y: 0, visible: false };
		_box.getCenter(_c); _c.y = _box.max.y;                       // top-centre
		const p = _c.clone().project(camera);
		const r = canvas.getBoundingClientRect();
		return { x: r.left + (p.x * 0.5 + 0.5) * r.width, y: r.top + (-p.y * 0.5 + 0.5) * r.height, visible: p.z < 1 };
	}
	/** current controllable anchors on the car: slot weapons, placed weapons, slick tires */
	function anchors() {
		const out = [];
		if (attached.front) out.push({ id: attached.front.userData.slot.id, kind: "front", object: attached.front });
		if (attached.rear) out.push({ id: attached.rear.userData.slot.id, kind: "rear", object: attached.rear });
		placed.forEach((p, i) => out.push({ id: p.id, kind: "placed", ord: i, object: p.object }));
		let ti = 0; for (const o of slick.values()) out.push({ id: "slick_tire", kind: "tire", ord: ti++, object: o });
		return out.map((a) => ({ ...a, screen: projectTop(a.object) }));
	}

	// ---- dev/test hooks (harmless; used by the placement tuning harness) ----
	function _testPlace(id, clientX, clientY, roll = 0) {
		const item = BY_ID[id];
		if (!item || item.mount !== "place") return null;
		placeRoll = roll;
		const hit = hitCar({ clientX, clientY });
		if (hit) commit(item, hit);
		return hit ? placed[placed.length - 1].matrix.elements[12] : null;   // mount-local x (side)
	}
	function _clear() { for (const p of placed) dropObject(p.object); placed.length = 0; }
	function _slotScreen(key) {
		const o = attached[key]; if (!o) return null;
		camera.updateMatrixWorld(true); o.updateWorldMatrix(true, true);
		const r = canvas.getBoundingClientRect();
		const proj = new THREE.Box3().setFromObject(o).getCenter(new THREE.Vector3()).project(camera);
		const cx = r.left + (proj.x * 0.5 + 0.5) * r.width, cy = r.top + (-proj.y * 0.5 + 0.5) * r.height;
		const tryHit = (x, y) => { ndc.set(((x - r.left) / r.width) * 2 - 1, -((y - r.top) / r.height) * 2 + 1); ray.setFromCamera(ndc, camera); return ray.intersectObject(o, true).length > 0; };
		if (tryHit(cx, cy)) return { x: cx, y: cy };
		for (let dy = -r.height * 0.45; dy <= r.height * 0.45; dy += 5) if (tryHit(cx, cy + dy)) return { x: cx, y: cy + dy };
		return { x: cx, y: cy };
	}

	return { syncLoadout, setHeld, setCallbacks, fireAnim, scene, car, camera, controls, placed, anchors, _testPlace, _clear, _slotScreen, _poseRig, _armTest };
}
