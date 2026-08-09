/**
 * ============================================================================
 * craft/three/library.js
 * ----------------------------------------------------------------------------
 * Loads assets/models/parts_and_weapons_lite.glb (geometry-only) and rebuilds
 * every material at runtime from src/craft/materialManifest.json + the external
 * maps in assets/tex/ — same slim-GLB + external-tex approach as the arena POC.
 *
 * Produces:
 *   - buildCar()        : the DemoCar (body + 4 grip wheels) with a mount frame
 *                         + captured wheel-slot transforms.
 *   - bakeItem(item)    : a pivot-local THREE.Group for any catalog item, with
 *                         demo/nested nodes excluded and hand-sockets computed.
 *   - slotTransforms    : authored local TRS for fixed front/back/battery items.
 *
 * NOTE: three's GLTFLoader strips dots from node names (Fist.001 -> Fist001);
 * every lookup here sanitizes the same way.
 * ============================================================================
 */

import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import manifest from "../materialManifest.json";
import { ITEMS, BY_ID, DEMO_NODES } from "../data.js";
import { familyScale, HAND } from "../placement.js";

/** Per-hand fine-tune multiplier on the unified target size (kancho is a prod, not a fist). */
const HAND_MUL = { slap_hand: 1, fist: 1, kancho: 1.15 };
/** Per-composite extra hand rotation (Euler, applied in hand-local before the socket).
 *  The kancho prod reads great facing forward on pipes/springs, but on the ram it should
 *  point along the piston's motion (axial) instead. */
const HAND_TWEAK = {
	hyd_piston__kancho: [0, -Math.PI / 2, 0],   // axial along the ram
	scorpion_tail__kancho: [0, -Math.PI / 2, 0], // point forward (strike dir), like the fist
};
/** Which local axis of a hand mirrors it left<->right (tuned visually). */
const MIRROR_AXIS = "z";
/** How far to slide the piston rod back so it crafts contracted — NOT all the way,
 *  so the ram's attach cylinder stays exposed and the hand doesn't clip the body. */
const PISTON_CONTRACT = 0.24;

const GLB_URL = new URL("../../../assets/models/parts_and_weapons_lite.glb", import.meta.url).href;
// Re-exported hands (subdivision applied, scale baked to 1) — the authoritative hand geometry.
const HANDS_URL = new URL("../../../assets/models/hands_re-export.glb", import.meta.url).href;
/** hand item id -> node name in hands_re-export.glb */
const HAND_SRC = { slap_hand: "SlapHand.005", fist: "Fist.004", kancho: "KanchoProd.001" };
const TEX = (() => {
	const glob = import.meta.glob("../../../assets/tex/*.{png,jpg,jpeg}", { eager: true, query: "?url", import: "default" });
	/** @type {Record<string,string>} */ const m = {};
	for (const [p, url] of Object.entries(glob)) { const f = p.split("/").pop(); if (f) m[f] = url; }
	return m;
})();
const WRAP = { repeat: THREE.RepeatWrapping, clamp: THREE.ClampToEdgeWrapping, mirror: THREE.MirroredRepeatWrapping };

/** @param {string} n @returns {string} three-sanitized node name (dots removed). */
const strip = (n) => (n || "").replace(/\./g, "");

/**
 * Load the parts library and return the crafting registry.
 * @param {THREE.WebGLRenderer} renderer For max-anisotropy.
 * @returns {Promise<object>} Registry.
 */
export async function loadCraftLibrary(renderer) {
	const maxAniso = renderer.capabilities.getMaxAnisotropy();
	const gltfLoader = new GLTFLoader();
	const [gltf, handsGltf] = await Promise.all([gltfLoader.loadAsync(GLB_URL), gltfLoader.loadAsync(HANDS_URL)]);
	const root = gltf.scene;
	root.updateWorldMatrix(true, true);
	const handsRoot = handsGltf.scene;
	handsRoot.updateWorldMatrix(true, true);

	const find = (raw) => root.getObjectByName(strip(raw));
	const findHand = (raw) => handsRoot.getObjectByName(strip(raw));

	// ---- material rebuild (manifest + external tex) -----------------------
	const loader = new THREE.TextureLoader();
	const texCache = new Map();
	const tex = (slot) => {
		if (!slot || !slot.file || !TEX[slot.file]) return null;
		if (texCache.has(slot.file)) return texCache.get(slot.file);
		const t = loader.load(TEX[slot.file]);
		t.flipY = false;
		t.colorSpace = slot.colorSpace === "srgb" ? THREE.SRGBColorSpace : THREE.NoColorSpace;
		t.wrapS = WRAP[slot.wrapS] ?? THREE.RepeatWrapping;
		t.wrapT = WRAP[slot.wrapT] ?? THREE.RepeatWrapping;
		t.anisotropy = maxAniso;
		t.needsUpdate = true;
		texCache.set(slot.file, t);
		return t;
	};
	const matCache = new Map();
	const material = (name) => {
		if (matCache.has(name)) return matCache.get(name);
		const md = manifest.materials[name];
		const mat = new THREE.MeshStandardMaterial();
		if (md) {
			const bc = md.baseColorFactor || [1, 1, 1, 1];
			mat.color.setRGB(bc[0], bc[1], bc[2]);
			mat.metalness = md.metallicFactor ?? 1;
			mat.roughness = md.roughnessFactor ?? 1;
			const bm = tex(md.baseColor); if (bm) mat.map = bm;
			const mr = tex(md.metallicRoughness); if (mr) { mat.metalnessMap = mr; mat.roughnessMap = mr; }
			const nm = tex(md.normal); if (nm) { mat.normalMap = nm; const s = md.normalScale ?? 1; mat.normalScale.set(s, s); }
			const em = tex(md.emissive);
			if (em) { mat.emissiveMap = em; mat.emissive.setRGB(1, 1, 1); }
			if (md.emissiveFactor) mat.emissive.setRGB(md.emissiveFactor[0], md.emissiveFactor[1], md.emissiveFactor[2]);
			if (md.doubleSided) mat.side = THREE.DoubleSide;
			if (md.alphaMode === "BLEND") { mat.transparent = true; mat.opacity = bc[3]; }
			if (md.alphaMode === "MASK") mat.alphaTest = md.alphaTest ?? 0.5;
		} else {
			console.warn("[craft] no manifest material:", name);
			mat.color.setRGB(0.6, 0.6, 0.6);
		}
		mat.name = name;
		matCache.set(name, mat);
		return mat;
	};

	// Which nodes delimit separate items/demos (stop geometry bleed on bake).
	const KNOWN = new Set();
	for (const it of ITEMS) for (const n of (it.group || [it.node])) KNOWN.add(strip(n));
	for (const n of DEMO_NODES) KNOWN.add(strip(n));

	// ---- canonical geometry fixes, computed once against the GLB ----
	/** id -> { preRot?:Matrix4, contract?:{node,vec} } applied inside bakeItem */
	const CANON = {};
	// LongPipe is authored pointing +Y; rotate it to +X so it matches every other base.
	CANON.long_pipe = { preRot: new THREE.Matrix4().makeRotationZ(-Math.PI / 2) };
	// The piston ram is modeled EXTENDED; retract the rod node back along the piston's
	// long axis (base-local -X) so it crafts/places contracted (the extend animation
	// will push it out later). The attached hand rides in with it (see bakeComposite).
	CANON.hyd_piston = { contract: { node: strip("HydraulicPiston.001"), vec: new THREE.Vector3(-PISTON_CONTRACT, 0, 0) } };

	/**
	 * Bake an item into a pivot-local group (its root node at identity),
	 * excluding demo hands and any nested different item.
	 * @param {object} item @returns {THREE.Group}
	 */
	function bakeItem(item) {
		const r = find(item.node);
		const group = new THREE.Group();
		group.name = item.id;
		if (!r) { console.warn("[craft] missing node for", item.id); return group; }
		const include = new Set((item.group || [item.node]).map(strip));
		const inv = new THREE.Matrix4().copy(r.matrixWorld).invert();
		r.updateWorldMatrix(true, true);
		const canon = CANON[item.id] || {};
		const preRot = canon.preRot || null, contract = canon.contract || null;
		r.traverse((o) => {
			if (!o.isMesh) return;
			// skip meshes owned by an excluded known node; note membership of the contract node
			let inContract = false;
			for (let a = o; a && a !== r; a = a.parent) {
				const n = strip(a.name);
				if (KNOWN.has(n) && !include.has(n)) return;
				if (contract && n === contract.node) inContract = true;
			}
			const g = o.geometry.clone();
			g.applyMatrix4(new THREE.Matrix4().multiplyMatrices(inv, o.matrixWorld));
			if (inContract) g.translate(contract.vec.x, contract.vec.y, contract.vec.z);
			if (preRot) g.applyMatrix4(preRot);
			const mn = Array.isArray(o.material) ? o.material[0]?.name : o.material?.name;
			group.add(new THREE.Mesh(g, material(mn)));
		});
		return group;
	}

	/** measure a group's local bounding size (max dimension). */
	function maxDim(group) {
		const b = new THREE.Box3().setFromObject(group);
		if (b.isEmpty()) return 1;
		const s = b.getSize(new THREE.Vector3());
		return Math.max(s.x, s.y, s.z) || 1;
	}

	/**
	 * Bake a hand from hands_re-export.glb into its node-local frame (which strips the
	 * export-scene placement rotation, leaving the hand's canonical orientation — the
	 * same frame the sockets were authored against). Keeps the glb's own material.
	 * @param {string} handId @returns {THREE.Group}
	 */
	function bakeHand(handId) {
		const group = new THREE.Group(); group.name = handId;
		const r = findHand(HAND_SRC[handId]);
		if (!r) { console.warn("[craft] missing re-export hand for", handId); return group; }
		r.updateWorldMatrix(true, true);
		const inv = new THREE.Matrix4().copy(r.matrixWorld).invert();
		r.traverse((o) => {
			if (!o.isMesh) return;
			const g = o.geometry.clone();
			g.applyMatrix4(new THREE.Matrix4().multiplyMatrices(inv, o.matrixWorld));
			group.add(new THREE.Mesh(g, o.material));
		});
		return group;
	}

	/**
	 * Bake a composite (a hand welded onto a base) into one pivot-local group:
	 * the base at identity, the hand placed at the base's authored hand-socket.
	 * @param {string} baseId @param {string} handId @param {string} socketKey
	 * @returns {THREE.Group}
	 */
	function bakeComposite(baseId, handId, socketKey, opts = {}) {
		const group = new THREE.Group();
		group.name = `${baseId}__${handId}`;
		group.add(bakeItem(BY_ID[baseId]));                 // base (canon fixes auto-applied)

		// Unified hand: bake, normalize to a target size (about the wrist origin), then
		// orient + place with the socket's ROTATION and TRANSLATION only — the socket's
		// SCALE (which carries the base node's scale) is discarded, so every hand on every
		// base comes out the same physical size regardless of how the demo was authored.
		const hand = bakeHand(handId);
		const k = (HAND.target * (HAND_MUL[handId] ?? 1)) / maxDim(hand);
		hand.scale.setScalar(k);
		const tw = HAND_TWEAK[`${baseId}__${handId}`];
		if (tw) hand.quaternion.setFromEuler(new THREE.Euler(tw[0], tw[1], tw[2]));
		if (opts.mirror) hand.scale["xyz".indexOf(MIRROR_AXIS) >= 0 ? MIRROR_AXIS : "z"] *= -1;

		const holder = new THREE.Group();
		const sk = sockets[baseId];
		const m = (sk && (sk[socketKey] || sk.default)) || new THREE.Matrix4();
		const t = new THREE.Vector3(), q = new THREE.Quaternion(), s = new THREE.Vector3();
		m.decompose(t, q, s);
		holder.position.copy(t); holder.quaternion.copy(q);
		// the ram's hand rides on the moving rod — shift it in with the contraction so it stays attached
		const canon = CANON[baseId];
		if (canon && canon.contract) holder.position.add(canon.contract.vec);
		holder.add(hand);
		group.add(holder);

		const fs = opts.familyScale ?? 1;
		if (fs !== 1) group.scale.setScalar(fs);
		return group;
	}

	/**
	 * Bake any catalog item by id — routes composites through bakeComposite (with
	 * per-base family scale + optional left-side mirror), everything else through bakeItem.
	 * @param {string} id @param {{mirror?:boolean}} [opts] @returns {THREE.Group}
	 */
	function bakeById(id, opts = {}) {
		const it = BY_ID[id];
		if (HAND_SRC[id]) return bakeHand(id);           // standalone hand thumbnail (re-export glb)
		if (it && it.composite) {
			return bakeComposite(it.composite.base, it.composite.hand, it.composite.socket, {
				mirror: !!opts.mirror,
				familyScale: familyScale(it.composite.base),
			});
		}
		const g = bakeItem(it || { id, node: id });
		if (it && it.placeScale && it.placeScale !== 1) g.scale.setScalar(it.placeScale);
		return g;
	}

	// ---- animatable rigs (hierarchy preserved so joints can move) ----------
	/** base id -> { node, type, demo(hand node to replace), joints(rig)->{...} } */
	const RIG_META = {
		hyd_piston: { node: "HydraulicPiston", type: "ram", demo: "Fist",
			joints: (rig) => ({ rod: rig.getObjectByName(strip("HydraulicPiston.001")) }) },
		side_saw: { node: "SideSaw", type: "saw", demo: null,
			joints: (rig) => ({ blade: rig.getObjectByName(strip("SideSawBlade")) }) },
	};
	/** @param {string} id @returns {string|null} rig type if this item animates with a rig */
	function rigType(id) {
		const it = BY_ID[id];
		const base = it && it.composite ? it.composite.base : id;
		return RIG_META[base] ? RIG_META[base].type : null;
	}
	/**
	 * Build a LIVE, articulated instance of an animatable weapon: the base's node
	 * subtree cloned from the GLB (transforms intact), materials rebuilt, demo hand
	 * swapped for the chosen unified hand parented to the moving joint. Returns the
	 * placeable group + named joints + rest data for the animator.
	 * @param {string} id @returns {{group:THREE.Group, type:string, joints:object, contract:number}}
	 */
	function bakeRig(id) {
		const it = BY_ID[id];
		const base = it && it.composite ? it.composite.base : id;
		const handId = it && it.composite ? it.composite.hand : null;
		const meta = RIG_META[base];
		const src = find(BY_ID[base].node);
		const rig = src.clone(true);
		rig.position.set(0, 0, 0); rig.quaternion.identity(); rig.scale.set(1, 1, 1);
		rig.updateMatrixWorld(true);

		// capture + remove the demo hand (its local transform under its joint = the attach)
		let joint = null, hpos = null, hquat = null;
		if (meta.demo) {
			const demo = rig.getObjectByName(strip(meta.demo));
			if (demo) { joint = demo.parent; hpos = demo.position.clone(); hquat = demo.quaternion.clone(); demo.parent.remove(demo); }
		}
		for (const dn of DEMO_NODES) { const d = rig.getObjectByName(strip(dn)); if (d && d.parent) d.parent.remove(d); }

		// rebuild materials from the manifest (clone carries the raw glb materials)
		rig.traverse((o) => { if (o.isMesh) { const mn = Array.isArray(o.material) ? o.material[0]?.name : o.material?.name; o.material = material(mn); } });

		// attach the chosen hand to the moving joint at the demo hand's own local transform
		if (handId && joint) {
			const hand = bakeHand(handId);
			hand.scale.setScalar((HAND.target * (HAND_MUL[handId] ?? 1)) / maxDim(hand));
			const tw = HAND_TWEAK[`${base}__${handId}`];
			if (tw) hand.quaternion.setFromEuler(new THREE.Euler(tw[0], tw[1], tw[2]));
			const holder = new THREE.Group(); holder.position.copy(hpos); holder.quaternion.copy(hquat); holder.add(hand);
			joint.add(holder);
		}

		const joints = meta.joints(rig);
		const out = new THREE.Group(); out.add(rig);
		const fs = familyScale(base);
		if (fs !== 1) out.scale.setScalar(fs);
		else if (BY_ID[base]?.placeScale) out.scale.setScalar(BY_ID[base].placeScale);

		const rigObj = { group: out, type: meta.type, joints, contract: PISTON_CONTRACT };
		if (meta.type === "ram" && joints.rod) joints.rod.position.x = -PISTON_CONTRACT;   // rest = contracted
		return rigObj;
	}

	// ---- hand sockets (item-root-local transform of the demo hand) --------
	/** id -> { default?:Matrix4, fist?:Matrix4, slap?:Matrix4 } */
	const sockets = {};
	const socketFrom = (itemNode, handNode) => {
		const r = find(itemNode), h = find(handNode);
		if (!r || !h) return null;
		return new THREE.Matrix4().copy(r.matrixWorld).invert().multiply(h.matrixWorld);
	};
	sockets["short_pipe"] = { default: socketFrom("ShortPipe", "SlapHand") };
	sockets["spring"] = { default: socketFrom("Spring", "SlapHand.001") };
	sockets["hyd_piston"] = { default: socketFrom("HydraulicPiston", "Fist") };
	sockets["hyd_arm"] = { fist: socketFrom("HydraulicArm", "Fist.001"), slap: socketFrom("HydraulicArm.001", "SlapHand.003") };
	sockets["scorpion_tail"] = { default: socketFrom("ScorpoinTailBase", "Fist.002") };
	// long pipe: no demo hand. It's canon-rotated to +X (see CANON), so reuse the
	// short-pipe hand ORIENTATION and just move the wrist out to the long tip.
	sockets["long_pipe"] = (() => {
		const base = sockets["short_pipe"].default ? sockets["short_pipe"].default.clone() : new THREE.Matrix4();
		base.setPosition(1.45, 0, 0);
		return { default: base };
	})();

	// ---- fixed-slot authored transforms -----------------------------------
	/** id -> {position, quaternion, scale} local under the reference car. */
	const slotTransforms = {};
	for (const it of ITEMS) {
		if (!["front", "back", "battery"].includes(it.mount)) continue;
		const n = find(it.node);
		if (!n) continue;
		slotTransforms[it.id] = { position: n.position.clone(), quaternion: n.quaternion.clone(), scale: n.scale.clone() };
	}

	/**
	 * Build the DemoCar: body + 4 grip wheels, a mount frame for weapons, and
	 * the wheel-slot transforms for grip<->slick swapping.
	 * @returns {object}
	 */
	function buildCar() {
		const src = find("DemoCar");
		const car = new THREE.Group();
		car.name = "DemoCar";
		// Copy the DemoCar node's own local transform so slot transforms line up.
		car.position.copy(src.position);
		car.quaternion.copy(src.quaternion);
		car.scale.copy(src.scale);

		/** @type {THREE.Mesh[]} */ const carPaint = [];
		const wheelSlots = [];
		src.updateWorldMatrix(true, true);
		const inv = new THREE.Matrix4().copy(src.matrixWorld).invert();

		src.traverse((o) => {
			if (!o.isMesh) return;
			// wheel meshes live under GripTire001..004 nodes.
			let wheelName = null;
			for (let a = o; a && a !== src; a = a.parent) if (/^GripTire00\d$/.test(a.name)) { wheelName = a.name; break; }
			const g = o.geometry.clone();
			g.applyMatrix4(new THREE.Matrix4().multiplyMatrices(inv, o.matrixWorld));
			const mn = Array.isArray(o.material) ? o.material[0]?.name : o.material?.name;
			const mesh = new THREE.Mesh(g, material(mn));
			mesh.userData.carPaint = mn === "CarPaint.001";
			if (mesh.userData.carPaint) carPaint.push(mesh);
			mesh.userData.wheel = wheelName;
			car.add(mesh);
		});

		// Capture the 4 wheel-slot local transforms (from the wheel nodes).
		for (let i = 1; i <= 4; i++) {
			const wn = find("GripTire.00" + i);
			if (!wn) continue;
			const m = new THREE.Matrix4().multiplyMatrices(inv, wn.matrixWorld);
			const pos = new THREE.Vector3(), quat = new THREE.Quaternion(), scl = new THREE.Vector3();
			m.decompose(pos, quat, scl);
			wheelSlots.push({ index: i, position: pos, quaternion: quat, scale: scl });
		}

		return { object: car, mountParent: car, carPaint, wheelSlots };
	}

	return { root, material, bakeItem, bakeComposite, bakeById, bakeRig, rigType, buildCar, sockets, slotTransforms, strip: (id) => strip(id) };
}
