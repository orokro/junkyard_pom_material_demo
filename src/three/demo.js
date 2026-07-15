/**
 * ============================================================================
 * three/demo.js
 * ----------------------------------------------------------------------------
 * Phase 2 demo orchestration: a single 3 m POM cube on a reference grid, lit
 * and explorable with the fly camera. Loads all four tile sets so the sidebar
 * "Preview tile" control can swap between them live.
 *
 * Returns an API the app uses to push runtime-config changes (POM, camera,
 * FOV, preview tile), reset the view, and tear everything down.
 * ============================================================================
 */

import * as THREE from "three";
import { createScene } from "./scene.js";
import { createFlyControls } from "./flyCamera.js";
import { loadAllTiles } from "./textures.js";
import { createPomMaterial } from "./pomMaterial.js";

const HOME_POS = new THREE.Vector3(5, 3.4, 7);
const HOME_TARGET = new THREE.Vector3(0, 1.5, 0);

/**
 * @typedef {object} DemoApi
 * @property {(key: string, value: *) => void} applyRuntime
 * @property {() => void} resetView
 * @property {() => void} dispose
 */

/**
 * Boot the Phase 2 cube demo.
 * @param {HTMLCanvasElement} canvas Target canvas.
 * @param {Record<string, *>} runtime Runtime config (mutated live by the sidebar).
 * @param {(loaded: number, total: number) => void} [onProgress] Texture progress.
 * @returns {Promise<DemoApi>} Demo control API.
 */
export async function startDemo(canvas, runtime, onProgress) {
	const bundle = createScene(canvas, runtime.cameraFov ?? 70);
	const { renderer, scene, camera } = bundle;

	// Reference grid at Y=0 so motion + scale read clearly.
	const grid = new THREE.GridHelper(120, 40, 0x2b3441, 0x1c232d);
	grid.position.y = 0;
	scene.add(grid);

	// Load tiles and build the POM cube.
	const maxAniso = renderer.capabilities.getMaxAnisotropy();
	const tiles = await loadAllTiles(maxAniso, onProgress);
	const startIndex = THREE.MathUtils.clamp(Math.round(runtime.previewTile ?? 1), 1, 4);
	const pom = createPomMaterial(tiles[startIndex - 1], runtime);

	const cube = new THREE.Mesh(new THREE.BoxGeometry(3, 3, 3), pom.material);
	cube.position.set(0, 1.5, 0);
	scene.add(cube);

	// Fly controls.
	const controls = createFlyControls(camera, canvas, runtime.cameraSpeed ?? 18);
	controls.placeLookingAt(HOME_POS, HOME_TARGET);

	bundle.setUpdate((dt) => {
		controls.update(dt);
	});
	bundle.start();

	return {
		applyRuntime(key, value) {
			switch (key) {
				case "pomStrength":
				case "pomSteps":
				case "pomInvertDepth":
					pom.applyRuntime({ [key]: value });
					break;
				case "cameraSpeed":
					controls.setSpeed(value);
					break;
				case "cameraFov":
					bundle.setFov(value);
					break;
				case "previewTile": {
					const idx = THREE.MathUtils.clamp(Math.round(value), 1, 4);
					pom.setTile(tiles[idx - 1]);
					break;
				}
				default:
					break;
			}
		},
		resetView() {
			controls.placeLookingAt(HOME_POS, HOME_TARGET);
		},
		dispose() {
			controls.dispose();
			cube.geometry.dispose();
			pom.material.dispose();
			for (const t of tiles) {
				t.albedo.dispose();
				t.normal.dispose();
				t.metal.dispose();
				t.rough.dispose();
				t.depth.dispose();
			}
			grid.geometry.dispose();
			bundle.dispose();
		},
	};
}
