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

const GLB_URL = new URL("../../../assets/models/parts_and_weapons_lite.glb", import.meta.url).href;
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
	const gltf = await new GLTFLoader().loadAsync(GLB_URL);
	const root = gltf.scene;
	root.updateWorldMatrix(true, true);

	const find = (raw) => root.getObjectByName(strip(raw));

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
		r.traverse((o) => {
			if (!o.isMesh) return;
			// skip meshes owned by an excluded known node between root (excl) and mesh
			for (let a = o; a && a !== r; a = a.parent) {
				const n = strip(a.name);
				if (KNOWN.has(n) && !include.has(n)) return;
			}
			const g = o.geometry.clone();
			g.applyMatrix4(new THREE.Matrix4().multiplyMatrices(inv, o.matrixWorld));
			const mn = Array.isArray(o.material) ? o.material[0]?.name : o.material?.name;
			group.add(new THREE.Mesh(g, material(mn)));
		});
		return group;
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
	// long pipe: no demo — reuse short-pipe direction scaled out along +X (tuning).
	sockets["long_pipe"] = { default: new THREE.Matrix4().makeTranslation(1.29, 0, 0) };

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

	return { root, material, bakeItem, buildCar, sockets, slotTransforms, strip: (id) => strip(id) };
}
