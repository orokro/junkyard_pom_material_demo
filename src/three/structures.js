/**
 * ============================================================================
 * three/structures.js
 * ----------------------------------------------------------------------------
 * Loads the structure library (jy_structures_library.glb) into a registry
 * keyed by group: global / tire / rust. Items are named
 *   item_{NxN}_(odds_)(mod_)snake_name
 * and may be single meshes or (multi-material / multi-part) groups.
 *
 * Each item is flattened into a template Group: every descendant mesh has its
 * world matrix baked into a cloned geometry (so orientation is correct and
 * robust to Blender/glTF node transforms), then shifted so the item's authored
 * pivot sits at the origin. Placement = clone the template, set position +
 * Y-rotation.
 * ============================================================================
 */

import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";

const GLB_URL = new URL("../../assets/models/jy_structures_library.glb", import.meta.url).href;
const loader = new GLTFLoader();

/** item_{nx}x{nz}_(odds_)(mod_)name — odds then mod are optional leading ints. */
const ITEM_RE = /^item_(\d+)x(\d+)_(?:(\d+)_)?(?:(\d+)_)?(.+)$/;

/**
 * @typedef {object} StructureItem
 * @property {string} name
 * @property {string} label
 * @property {number} nx
 * @property {number} nz
 * @property {number|null} odds
 * @property {number|null} mod
 * @property {THREE.Group} template
 */

/**
 * @typedef {object} StructureRegistry
 * @property {StructureItem[]} global
 * @property {StructureItem[]} tire
 * @property {StructureItem[]} rust
 */

/**
 * Parse an item name.
 * @param {string} name
 * @returns {{nx: number, nz: number, odds: number|null, mod: number|null, label: string}|null}
 */
export function parseItemName(name) {
	const m = name.match(ITEM_RE);
	if (!m) return null;
	return {
		nx: Number(m[1]),
		nz: Number(m[2]),
		odds: m[3] !== undefined ? Number(m[3]) : null,
		mod: m[4] !== undefined ? Number(m[4]) : null,
		label: m[5],
	};
}

/**
 * Load the structure library into a registry.
 * @returns {Promise<StructureRegistry>}
 */
export async function loadStructureLibrary() {
	const gltf = await loader.loadAsync(GLB_URL);
	gltf.scene.updateMatrixWorld(true);

	/** @type {StructureRegistry} */
	const registry = { global: [], tire: [], rust: [] };
	const pivot = new THREE.Vector3();

	gltf.scene.traverse((node) => {
		const gm = /** @type {string} */ (node.name || "").match(/^group_(\w+)$/);
		if (!gm) return;
		const bucket = /** @type {StructureItem[]|undefined} */ (registry[gm[1]]);
		if (!bucket) return;

		for (const itemNode of node.children) {
			const parsed = parseItemName(itemNode.name || "");
			if (!parsed) {
				console.warn("[jy] unparsed structure item:", itemNode.name);
				continue;
			}

			// Item's authored pivot = its world position (grid layout offset).
			itemNode.getWorldPosition(pivot);

			const template = new THREE.Group();
			let meshCount = 0;
			itemNode.traverse((o) => {
				const mesh = /** @type {THREE.Mesh} */ (o);
				if (!mesh.isMesh) return;
				const geo = mesh.geometry.clone();
				geo.applyMatrix4(mesh.matrixWorld); // to world orientation + position
				geo.translate(-pivot.x, -pivot.y, -pivot.z); // pivot → origin
				template.add(new THREE.Mesh(geo, mesh.material));
				meshCount++;
			});

			bucket.push({ name: itemNode.name || "", ...parsed, template });
			console.info(`[jy] structure ${itemNode.name} [${gm[1]}] — ${meshCount} mesh(es)`);
		}
	});

	return registry;
}
