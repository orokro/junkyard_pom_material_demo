/**
 * ============================================================================
 * three/wallEdge.js
 * ----------------------------------------------------------------------------
 * Pseudo-infinite boundary wall along the junkyard's western (spawn-side) edge.
 *
 * One 6 m segment (jy_wall.glb, material "RustyWall") is baked, rotated so its
 * 6 m span runs along Z, re-zeroed (base at Y=0, centred), then instanced and
 * re-tiled around the camera every frame — the same "fake infinite" trick the
 * dirt floor uses. The wall faces east into the yard and is hidden once the
 * camera is far enough east that it's out of range. It is a pure visual
 * backdrop: it lives outside the chunk groups, so the .glb map export ignores
 * it, just like the floor.
 * ============================================================================
 */

import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";

const GLB_URL = new URL("../../assets/models/jy_wall.glb", import.meta.url).href;
const loader = new GLTFLoader();
const SEG = 6; // segment width in metres (the model's long axis, now along Z)

/**
 * @typedef {object} WallEdge
 * @property {THREE.InstancedMesh} mesh
 * @property {(camera: THREE.Camera) => void} update Re-tile around the camera.
 * @property {(visible: boolean) => void} setVisible
 * @property {() => void} dispose
 */

/**
 * Build the infinite edge wall.
 * @param {number} wallX World X of the wall plane (the yard's western edge).
 * @param {number} rangeZ Half-length (m) of wall to keep around the camera in Z.
 * @param {number} hideBeyondX Cull the wall once the camera is this far east of it.
 * @returns {Promise<WallEdge>}
 */
export async function createWallEdge(wallX, rangeZ, hideBeyondX) {
	const gltf = await loader.loadAsync(GLB_URL);
	gltf.scene.updateMatrixWorld(true);

	/** @type {THREE.Mesh|null} */
	let src = null;
	gltf.scene.traverse((o) => {
		if (!src && /** @type {THREE.Mesh} */ (o).isMesh) src = /** @type {THREE.Mesh} */ (o);
	});
	if (!src) throw new Error("jy_wall.glb has no mesh");

	// Bake world orientation, rotate the 6 m span from X to Z (face ±Z → ±X, so
	// the wall runs north-south and faces into the yard), then re-zero: centred
	// on X/Z with its base at Y=0.
	const geo = src.geometry.clone();
	geo.applyMatrix4(src.matrixWorld);
	geo.rotateY(Math.PI / 2);
	geo.computeBoundingBox();
	const bb = geo.boundingBox;
	const cx = (bb.min.x + bb.max.x) / 2;
	const cz = (bb.min.z + bb.max.z) / 2;
	geo.translate(-cx, -bb.min.y, -cz);
	geo.computeBoundingSphere();

	const material = /** @type {THREE.MeshStandardMaterial} */ (src.material);
	material.side = THREE.DoubleSide; // never see-through if the front face is flipped

	const count = Math.ceil((2 * rangeZ) / SEG) + 2;
	const half = Math.floor(count / 2);
	const mesh = new THREE.InstancedMesh(geo, material, count);
	mesh.frustumCulled = false;
	mesh.renderOrder = -1;
	mesh.name = "jy_edge_wall";
	const dummy = new THREE.Object3D();

	return {
		mesh,
		update(camera) {
			if (camera.position.x - wallX > hideBeyondX) {
				mesh.visible = false;
				return;
			}
			mesh.visible = true;
			const baseZ = Math.round(camera.position.z / SEG) * SEG;
			for (let i = 0; i < count; i++) {
				dummy.position.set(wallX, 0, baseZ + (i - half) * SEG);
				dummy.updateMatrix();
				mesh.setMatrixAt(i, dummy.matrix);
			}
			mesh.instanceMatrix.needsUpdate = true;
		},
		setVisible(v) {
			mesh.visible = v;
		},
		dispose() {
			geo.dispose();
			for (const k of ["map", "normalMap", "roughnessMap", "metalnessMap", "aoMap", "emissiveMap"]) {
				if (material[k]) material[k].dispose();
			}
			material.dispose();
			mesh.dispose();
		},
	};
}
