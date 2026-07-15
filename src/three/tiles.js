/**
 * ============================================================================
 * three/tiles.js
 * ----------------------------------------------------------------------------
 * Loads jy_parts_v001.glb and builds a tile registry the generator consumes.
 *
 * Each tile's geometry is baked to world orientation (matrixWorld) and then
 * re-zeroed so its bounding box is exactly X:[0,3] Y:[0,h] Z:[0,3] — min corner
 * at the origin. This discards the Blender grid-layout offset (which lives in
 * the node transform) and gives every tile one canonical local frame, so
 * placement is a pure translation to a cell's min corner.
 *
 * Names are parsed into structured entries per the convention:
 *   jyt_flat_{lvl}                         (e.g. jyt_flat_2.3)
 *   jyt_ramp_{dir}_{fromLvl}_to_{toLvl}    (e.g. jyt_ramp_e_0_to_1.3)
 * where lvl uses '.' as '/': 0, 1.3, 2.3, 3.3 → integer meters 0,1,2,3.
 * ============================================================================
 */

import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";

const GLB_URL = new URL("../../assets/models/jy_parts_v001.glb", import.meta.url).href;
const loader = new GLTFLoader();

/**
 * Level token → integer meters. NOTE: GLTFLoader strips '.' from node names on
 * import (it sanitizes reserved characters), so the authored `1.3`/`2.3`/`3.3`
 * arrive as `13`/`23`/`33`. We match the runtime (dot-less) form here.
 */
const LEVELS = { "0": 0, "13": 1, "23": 2, "33": 3 };

/**
 * @typedef {object} TileEntry
 * @property {string} name         Original mesh name.
 * @property {"flat"|"ramp"|"unknown"} kind
 * @property {string|null} dir      Cardinal direction for ramps (n/ne/.../nw).
 * @property {number|null} from     Ramp start level in meters.
 * @property {number|null} to       Ramp end level in meters.
 * @property {number} height        Bounding-box height in meters.
 * @property {THREE.BufferGeometry} geometry Re-zeroed geometry (min at origin).
 */

/**
 * Parse a tile name into structured fields.
 * @param {string} name Mesh name.
 * @returns {{kind: string, dir: string|null, from: number|null, to: number|null}|null}
 */
export function parseTileName(name) {
	const flat = name.match(/^jyt_flat_(0|13|23|33)$/);
	if (flat) return { kind: "flat", dir: null, from: null, to: LEVELS[flat[1]] };
	const ramp = name.match(/^jyt_ramp_(n|ne|e|se|s|sw|w|nw)_(0|13|23|33)_to_(0|13|23|33)$/);
	if (ramp) return { kind: "ramp", dir: ramp[1], from: LEVELS[ramp[2]], to: LEVELS[ramp[3]] };
	return null;
}

/**
 * Load the GLB and build the tile registry.
 * @returns {Promise<{ registry: Map<string, TileEntry>, list: TileEntry[] }>}
 */
export async function loadTileRegistry() {
	const gltf = await loader.loadAsync(GLB_URL);
	gltf.scene.updateMatrixWorld(true);

	/** @type {Map<string, TileEntry>} */
	const registry = new Map();
	/** @type {TileEntry[]} */
	const list = [];
	const size = new THREE.Vector3();

	gltf.scene.traverse((obj) => {
		if (!(/** @type {THREE.Mesh} */ (obj).isMesh)) return;
		const mesh = /** @type {THREE.Mesh} */ (obj);

		// Bake world orientation, then re-zero so min corner sits at origin.
		const geometry = mesh.geometry.clone();
		geometry.applyMatrix4(mesh.matrixWorld);
		geometry.computeBoundingBox();
		const min = geometry.boundingBox.min.clone();
		geometry.translate(-min.x, -min.y, -min.z);
		geometry.computeBoundingBox();
		geometry.boundingBox.getSize(size);

		const parsed = parseTileName(mesh.name) || { kind: "unknown", dir: null, from: null, to: null };
		const entry = {
			name: mesh.name,
			kind: parsed.kind,
			dir: parsed.dir,
			from: parsed.from,
			to: parsed.to,
			height: Math.round(size.y),
			geometry,
		};
		registry.set(mesh.name, entry);
		list.push(entry);
	});

	list.sort((a, b) => a.name.localeCompare(b.name));
	return { registry, list };
}
