/**
 * ============================================================================
 * three/floor.js
 * ----------------------------------------------------------------------------
 * Pseudo-infinite dirt floor at Y=0.
 *
 * A single large plane is recentered under the camera every frame, and the
 * texture offset is scrolled by the camera's world XZ so the dirt appears
 * locked to the world (an infinite ground you fly over) rather than sliding
 * with you. Tile size is world-meters per texture repeat and is adjustable
 * live. No chunking — this replaces the chunk-based floor idea from the plan.
 * ============================================================================
 */

import * as THREE from "three";
import { loadDirtTextures } from "./textures.js";

const PLANE_SIZE = 10000; // large enough to reach the far plane in all directions

/**
 * @typedef {object} Floor
 * @property {THREE.Mesh} mesh
 * @property {(camera: THREE.Camera) => void} update Recenter + scroll per frame.
 * @property {(meters: number) => void} setTile Set world-meters per dirt repeat.
 * @property {(visible: boolean) => void} setVisible
 * @property {() => void} dispose
 */

/**
 * Build the scrolling dirt floor.
 * @param {number} maxAniso Max anisotropy from renderer capabilities.
 * @param {number} [tileMeters] Initial world size of one dirt repeat.
 * @returns {Promise<Floor>} Floor handle.
 */
export async function createFloor(maxAniso, tileMeters = 8) {
	const dirt = await loadDirtTextures(maxAniso);
	const maps = [dirt.albedo, dirt.normal, dirt.metal, dirt.rough];

	const geo = new THREE.PlaneGeometry(PLANE_SIZE, PLANE_SIZE);
	geo.rotateX(-Math.PI / 2); // lie flat in XZ, normal +Y

	const material = new THREE.MeshStandardMaterial({
		map: dirt.albedo,
		normalMap: dirt.normal,
		metalnessMap: dirt.metal,
		roughnessMap: dirt.rough,
		metalness: 1.0,
		roughness: 1.0,
	});

	const mesh = new THREE.Mesh(geo, material);
	mesh.position.y = 0;
	mesh.renderOrder = -1;

	let tile = tileMeters;

	/** @returns {void} Refresh texture repeat from the current tile size. */
	function applyRepeat() {
		const r = PLANE_SIZE / tile;
		for (const m of maps) m.repeat.set(r, r);
	}
	applyRepeat();

	return {
		mesh,
		update(camera) {
			// Recenter under the camera.
			mesh.position.x = camera.position.x;
			mesh.position.z = camera.position.z;
			// Scroll UVs to keep the dirt world-locked. If the floor appears to
			// "swim" as you fly, flip the sign on offset.y (axis handedness).
			const ox = camera.position.x / tile;
			const oy = -camera.position.z / tile;
			for (const m of maps) m.offset.set(ox, oy);
		},
		setTile(meters) {
			tile = Math.max(0.001, meters);
			applyRepeat();
		},
		setVisible(v) {
			mesh.visible = v;
		},
		dispose() {
			geo.dispose();
			material.dispose();
			for (const m of maps) m.dispose();
		},
	};
}
