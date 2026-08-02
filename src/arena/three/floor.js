/**
 * ============================================================================
 * arena/three/floor.js
 * ----------------------------------------------------------------------------
 * Pseudo-infinite arena floor at Y=0.
 *
 * A single large plane is recentered under the camera every frame, and the
 * texture offset is scrolled by the camera's world XZ so the floor appears
 * locked to the world (an infinite ground you walk/fly over) rather than
 * sliding with you. Tile size is world-meters per texture repeat and is
 * adjustable live.
 *
 * Uses the arena_floor texture set when present; otherwise falls back to a
 * generated placeholder texture so the POC runs before those assets exist.
 * Unlike the junkyard, there is NO boundary wall — the arena ground is open in
 * every direction.
 * ============================================================================
 */

import * as THREE from "three";
import { loadArenaFloorTextures } from "./textures.js";

const PLANE_SIZE = 10000; // large enough to reach the far plane in all directions

/**
 * @typedef {object} Floor
 * @property {THREE.Mesh} mesh
 * @property {boolean} usingFallback True when no arena_floor textures were found.
 * @property {(camera: THREE.Camera) => void} update Recenter + scroll per frame.
 * @property {(meters: number) => void} setTile Set world-meters per floor repeat.
 * @property {(visible: boolean) => void} setVisible
 * @property {() => void} dispose
 */

/**
 * Build a generated placeholder floor texture (dark asphalt with a faint grid),
 * used until the real arena_floor_*.png set is available.
 * @param {number} maxAniso Max anisotropy.
 * @returns {THREE.Texture} A tiling placeholder albedo texture.
 */
function makePlaceholderTexture(maxAniso) {
	const S = 512;
	const canvas = document.createElement("canvas");
	canvas.width = S;
	canvas.height = S;
	const ctx = /** @type {CanvasRenderingContext2D} */ (canvas.getContext("2d"));

	// Base asphalt.
	ctx.fillStyle = "#3a3d42";
	ctx.fillRect(0, 0, S, S);

	// Fine speckle so motion reads while scrolling.
	for (let i = 0; i < 4000; i++) {
		const x = Math.floor((i * 97.13) % S);
		const y = Math.floor((i * 57.31) % S);
		const shade = 40 + ((i * 29) % 40);
		ctx.fillStyle = `rgb(${shade},${shade + 2},${shade + 6})`;
		ctx.fillRect(x, y, 2, 2);
	}

	// Grid lines (one cell = one repeat quarter) to give a scale reference.
	ctx.strokeStyle = "rgba(255,210,61,0.10)";
	ctx.lineWidth = 2;
	for (let g = 0; g <= S; g += S / 4) {
		ctx.beginPath();
		ctx.moveTo(g + 0.5, 0);
		ctx.lineTo(g + 0.5, S);
		ctx.moveTo(0, g + 0.5);
		ctx.lineTo(S, g + 0.5);
		ctx.stroke();
	}

	const tex = new THREE.CanvasTexture(canvas);
	tex.colorSpace = THREE.SRGBColorSpace;
	tex.wrapS = THREE.RepeatWrapping;
	tex.wrapT = THREE.RepeatWrapping;
	tex.anisotropy = maxAniso;
	tex.needsUpdate = true;
	return tex;
}

/**
 * Build the scrolling arena floor.
 * @param {number} maxAniso Max anisotropy from renderer capabilities.
 * @param {number} [tileMeters] Initial world size of one floor repeat.
 * @returns {Promise<Floor>} Floor handle.
 */
export async function createFloor(maxAniso, tileMeters = 8) {
	const set = await loadArenaFloorTextures(maxAniso);
	const usingFallback = !set;

	/** @type {THREE.Texture[]} All maps that need their repeat/offset scrolled. */
	const maps = [];
	/** @type {THREE.MeshStandardMaterial} */
	let material;

	if (set) {
		material = new THREE.MeshStandardMaterial({
			map: set.albedo,
			normalMap: set.normal ?? null,
			metalnessMap: set.metal ?? null,
			roughnessMap: set.rough ?? null,
			metalness: set.metal ? 1.0 : 0.0,
			roughness: set.rough ? 1.0 : 0.95,
		});
		for (const t of [set.albedo, set.normal, set.metal, set.rough]) {
			if (t) maps.push(t);
		}
	} else {
		const placeholder = makePlaceholderTexture(maxAniso);
		material = new THREE.MeshStandardMaterial({
			map: placeholder,
			metalness: 0.0,
			roughness: 0.95,
		});
		maps.push(placeholder);
	}

	const geo = new THREE.PlaneGeometry(PLANE_SIZE, PLANE_SIZE);
	geo.rotateX(-Math.PI / 2); // lie flat in XZ, normal +Y

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
		usingFallback,
		update(camera) {
			// Recenter under the camera.
			mesh.position.x = camera.position.x;
			mesh.position.z = camera.position.z;
			// Scroll UVs to keep the floor world-locked.
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
