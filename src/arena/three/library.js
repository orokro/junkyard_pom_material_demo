/**
 * ============================================================================
 * arena/three/library.js
 * ----------------------------------------------------------------------------
 * Loads the geometry-only assets/models/arena_parts.glb and rebuilds each
 * part's materials at RUNTIME from external textures in assets/tex/, wired per
 * arena_material_manifest.json (extracted from the original textured GLB).
 *
 * Why: the original GLB was ~105 MB because of embedded textures. We ship a
 * 0.32 MB geometry-only GLB + the textures as normal files, and reconstruct the
 * materials here — same visual result, tiny model, no Draco.
 *
 * Each part may have several sub-meshes (multi-material parts like the bridge,
 * chairs, half-platform). We register an ARRAY of { geometry, material } per
 * part. Every sub-mesh geometry is baked so the PART's pivot sits at the origin
 * with world (Y-up) orientation, so build.js can place it with translate+rotateY.
 * ============================================================================
 */

import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import manifest from "../materialManifest.json";

const GLB_URL = new URL("../../../assets/models/arena_parts.glb", import.meta.url).href;

/** filename -> fingerprinted URL, for every texture in assets/tex. */
const TEX_URLS = (() => {
	const glob = import.meta.glob("../../../assets/tex/*.{png,jpg,jpeg}", { eager: true, query: "?url", import: "default" });
	/** @type {Record<string,string>} */
	const map = {};
	for (const [p, url] of Object.entries(glob)) {
		const f = p.split("/").pop();
		if (f) map[f] = /** @type {string} */ (url);
	}
	return map;
})();

export const PART_NAMES = [
	"Arena_ShippingContainer_Blue", "Arena_ShippingContainer_Red", "Arena_ShippingContainer_White",
	"Arena_ShippingContainer_Green", "Arena_Bridge", "Arena_Bench", "Arena_FoldingChair", "Arena_LawnChair",
	"Arena_PlasticChair", "Arena_TireBarrier_Straight_East", "Arena_TireBarrier_OuterCorner_NorthEast",
	"Arena_TireBarrier_InnerCorner_NorthEast", "Arena_HalfPlatform", "Arena_Ramp", "Arena_Ramp_Corner",
	"Arena_Metal_Barrier",
];

const WRAP = { repeat: THREE.RepeatWrapping, clamp: THREE.ClampToEdgeWrapping, mirror: THREE.MirroredRepeatWrapping };

/**
 * @typedef {object} PartEntry
 * @property {THREE.BufferGeometry} geometry  Pivot-centered, world-oriented.
 * @property {THREE.Material} material
 */

/**
 * Load the parts library + rebuild materials from external textures.
 * @param {number} maxAniso
 * @param {(loaded:number, total:number)=>void} [onProgress]
 * @returns {Promise<{ registry: Map<string, PartEntry[]>, missing: string[] }>}
 */
export async function loadArenaLibrary(maxAniso, onProgress) {
	const loader = new GLTFLoader();
	const gltf = await loader.loadAsync(GLB_URL, (e) => e && e.total && onProgress?.(e.loaded, e.total));
	gltf.scene.updateWorldMatrix(true, true);

	const texLoader = new THREE.TextureLoader();
	/** @type {Map<string, THREE.Texture>} */
	const texCache = new Map();
	/**
	 * @param {{file:string,colorSpace:string,wrapS:string,wrapT:string}|null} m
	 * @returns {THREE.Texture|null}
	 */
	const tex = (m) => {
		if (!m || !m.file || !TEX_URLS[m.file]) return null;
		const cacheKey = m.file;
		if (texCache.has(cacheKey)) return texCache.get(cacheKey);
		const t = texLoader.load(TEX_URLS[m.file]);
		t.flipY = false; // glTF UV convention (GLTFLoader does this); TextureLoader defaults to true
		t.colorSpace = m.colorSpace === "srgb" ? THREE.SRGBColorSpace : THREE.NoColorSpace;
		t.wrapS = WRAP[m.wrapS] ?? THREE.RepeatWrapping;
		t.wrapT = WRAP[m.wrapT] ?? THREE.RepeatWrapping;
		t.anisotropy = maxAniso;
		t.needsUpdate = true;
		texCache.set(cacheKey, t);
		return t;
	};

	/** @type {Map<string, THREE.Material>} */
	const matCache = new Map();
	/** @param {string} name @returns {THREE.Material} */
	const material = (name) => {
		if (matCache.has(name)) return matCache.get(name);
		const md = manifest.materials[name];
		const mat = new THREE.MeshStandardMaterial();
		if (md) {
			const bc = md.baseColorFactor || [1, 1, 1, 1];
			mat.color.setRGB(bc[0], bc[1], bc[2]);
			mat.metalness = md.metallicFactor ?? 1;
			mat.roughness = md.roughnessFactor ?? 1;
			const map = tex(md.baseColor);
			if (map) mat.map = map;
			const mr = tex(md.metallicRoughness);
			if (mr) { mat.metalnessMap = mr; mat.roughnessMap = mr; }
			const nm = tex(md.normal);
			if (nm) { mat.normalMap = nm; const s = md.normalScale ?? 1; mat.normalScale.set(s, s); }
			const em = tex(md.emissive);
			if (em) { mat.emissiveMap = em; mat.emissive.setRGB(1, 1, 1); }
			if (md.emissiveFactor) mat.emissive.setRGB(md.emissiveFactor[0], md.emissiveFactor[1], md.emissiveFactor[2]);
			if (md.doubleSided) mat.side = THREE.DoubleSide;
			if (md.alphaMode === "BLEND") { mat.transparent = true; mat.opacity = bc[3]; }
		} else {
			console.warn("[arena] no manifest material for", name);
			mat.color.setRGB(0.5, 0.5, 0.5);
		}
		matCache.set(name, mat);
		return mat;
	};

	/** @type {Map<string, PartEntry[]>} */
	const registry = new Map();
	const Tinv = new THREE.Matrix4();
	const M = new THREE.Matrix4();
	const p = new THREE.Vector3();
	const q = new THREE.Quaternion();
	const s = new THREE.Vector3();

	for (const name of PART_NAMES) {
		const node = gltf.scene.getObjectByName(name);
		if (!node) continue;
		node.matrixWorld.decompose(p, q, s); // p = pivot world position
		Tinv.makeTranslation(-p.x, -p.y, -p.z);
		/** @type {PartEntry[]} */
		const entries = [];
		node.traverse((o) => {
			if (!o.isMesh) return;
			const geo = o.geometry.clone();
			M.copy(o.matrixWorld).premultiply(Tinv); // world → pivot-local (no rotation of the frame)
			geo.applyMatrix4(M); // transforms position + normal correctly
			// Keep the GLB's authored (smooth) normals; only synthesize if missing.
			// Recomputing here would flatten/streak curved parts (e.g. chair tubing).
			if (!geo.getAttribute("normal")) geo.computeVertexNormals();
			const matName = Array.isArray(o.material) ? o.material[0]?.name : o.material?.name;
			entries.push({ geometry: geo, material: material(matName) });
		});
		if (entries.length) registry.set(name, entries);
	}

	const missing = PART_NAMES.filter((n) => !registry.has(n));
	if (missing.length) console.warn("[arena] missing parts in GLB:", missing);
	return { registry, missing };
}
