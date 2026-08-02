/**
 * ============================================================================
 * arena/three/library.js
 * ----------------------------------------------------------------------------
 * Loads assets/models/arena_parts.glb and builds a name → { geometry, material }
 * registry for the arena building blocks.
 *
 * Each piece's geometry is baked into WORLD-oriented axes with its PIVOT at the
 * origin: we take the mesh's world matrix (which includes the Blender→Y-up
 * conversion and the node's rotation/scale) and apply its rotation+scale — but
 * NOT its translation — to a clone of the geometry. The node translation is just
 * the Blender layout offset and is discarded, so every registry geometry is
 * centered on its authored pivot and can be placed with a plain translate+rotateY.
 * ============================================================================
 */

import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";

const GLB_URL = new URL("../../../assets/models/arena_parts.glb", import.meta.url).href;

/** Names we expect under the ArenaParts root. */
export const PART_NAMES = [
	"Arena_ShippingContainer_Blue",
	"Arena_ShippingContainer_Red",
	"Arena_ShippingContainer_White",
	"Arena_ShippingContainer_Green",
	"Arena_Bridge",
	"Arena_Bench",
	"Arena_FoldingChair",
	"Arena_LawnChair",
	"Arena_PlasticChair",
	"Arena_TireBarrier_Straight_East",
	"Arena_TireBarrier_OuterCorner_NorthEast",
	"Arena_TireBarrier_InnerCorner_NorthEast",
	"Arena_HalfPlatform",
	"Arena_Ramp",
	"Arena_Ramp_Corner",
	"Arena_Metal_Barrier",
];

/**
 * @typedef {object} PartEntry
 * @property {THREE.BufferGeometry} geometry  Pivot-centered, world-oriented.
 * @property {THREE.Material} material
 */

/**
 * Load the arena parts library.
 * @param {number} maxAniso  Max anisotropy from renderer capabilities.
 * @param {(loaded: number, total: number) => void} [onProgress]
 * @returns {Promise<{ registry: Map<string, PartEntry>, missing: string[] }>}
 */
export async function loadArenaLibrary(maxAniso, onProgress) {
	const loader = new GLTFLoader();
	const gltf = await loader.loadAsync(GLB_URL, (e) => {
		if (e && e.total) onProgress?.(e.loaded, e.total);
	});

	const targets = new Set(PART_NAMES);
	/** @type {Map<string, PartEntry>} */
	const registry = new Map();

	const pos = new THREE.Vector3();
	const quat = new THREE.Quaternion();
	const scale = new THREE.Vector3();

	gltf.scene.updateWorldMatrix(true, true);
	gltf.scene.traverse((obj) => {
		if (!obj.isMesh) return;
		// The piece name may be on the mesh or on its (group) parent node.
		const name = targets.has(obj.name) ? obj.name : targets.has(obj.parent?.name) ? obj.parent.name : null;
		if (!name || registry.has(name)) return;

		obj.matrixWorld.decompose(pos, quat, scale);
		const geometry = obj.geometry.clone();
		// Rotation + scale (no translation) → pivot stays at origin.
		const m = new THREE.Matrix4().compose(new THREE.Vector3(0, 0, 0), quat, scale);
		geometry.applyMatrix4(m);
		geometry.computeVertexNormals();

		const material = Array.isArray(obj.material) ? obj.material[0] : obj.material;
		// Improve texture crispness where maps exist.
		for (const slot of ["map", "normalMap", "roughnessMap", "metalnessMap"]) {
			if (material[slot]) material[slot].anisotropy = maxAniso;
		}
		registry.set(name, { geometry, material });
	});

	const missing = PART_NAMES.filter((n) => !registry.has(n));
	if (missing.length) console.warn("[arena] missing parts in GLB:", missing);
	return { registry, missing };
}
