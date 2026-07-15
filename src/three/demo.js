/**
 * ============================================================================
 * three/demo.js
 * ----------------------------------------------------------------------------
 * Phase 3.1 demo orchestration: loads the tile registry from the GLB and lays
 * every tile out in a labeled catalog (shared POM material) so orientation,
 * the re-zero anchor, and UVs can be verified before map generation. Includes
 * the scrolling dirt floor and fly camera.
 *
 * Returns an API the app uses to push runtime-config changes (POM, camera,
 * FOV, floor, preview tile), reset the view, and tear everything down.
 * ============================================================================
 */

import * as THREE from "three";
import { createScene } from "./scene.js";
import { createFlyControls } from "./flyCamera.js";
import { loadAllTiles } from "./textures.js";
import { createPomMaterial } from "./pomMaterial.js";
import { createFloor } from "./floor.js";
import { loadTileRegistry } from "./tiles.js";
import { buildCatalog } from "./catalog.js";

/**
 * Boot the Phase 3.1 catalog demo.
 * @param {HTMLCanvasElement} canvas Target canvas.
 * @param {Record<string, *>} runtime Runtime config (mutated live by the sidebar).
 * @param {(loaded: number, total: number) => void} [onProgress] Texture progress.
 * @returns {Promise<import("./demo.js").DemoApi>} Demo control API.
 */
export async function startDemo(canvas, runtime, onProgress) {
	const bundle = createScene(canvas, runtime.cameraFov ?? 70);
	const { renderer, scene, camera } = bundle;

	const maxAniso = renderer.capabilities.getMaxAnisotropy();

	// Textures + shared POM material.
	const tiles = await loadAllTiles(maxAniso, onProgress);
	const startIndex = THREE.MathUtils.clamp(Math.round(runtime.previewTile ?? 1), 1, 4);
	const pom = createPomMaterial(tiles[startIndex - 1], runtime);

	// Tile geometry registry + catalog view.
	const { list } = await loadTileRegistry();
	const catalog = buildCatalog(list, pom.material);
	scene.add(catalog.group);

	// Reference grid centered on the catalog.
	const grid = new THREE.GridHelper(160, 32, 0x2b3441, 0x1c232d);
	grid.position.set(catalog.center.x, 0.02, catalog.center.z);
	scene.add(grid);

	// Scrolling dirt floor.
	const floor = await createFloor(maxAniso, runtime.floorTileMeters ?? 8);
	floor.setVisible(runtime.floorVisible ?? true);
	scene.add(floor.mesh);

	// Camera framed to overlook the whole catalog.
	const homePos = new THREE.Vector3(catalog.center.x, catalog.center.y + 26, catalog.center.z + 44);
	const homeTarget = catalog.center.clone();

	const controls = createFlyControls(camera, canvas, runtime.cameraSpeed ?? 18);
	controls.placeLookingAt(homePos, homeTarget);

	bundle.setUpdate((dt) => {
		controls.update(dt);
		floor.update(camera);
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
				case "floorTileMeters":
					floor.setTile(value);
					break;
				case "floorVisible":
					floor.setVisible(value);
					break;
				default:
					break;
			}
		},
		resetView() {
			controls.placeLookingAt(homePos, homeTarget);
		},
		dispose() {
			controls.dispose();
			catalog.dispose();
			grid.geometry.dispose();
			floor.dispose();
			for (const t of tiles) {
				t.albedo.dispose();
				t.normal.dispose();
				t.metal.dispose();
				t.rough.dispose();
				t.depth.dispose();
			}
			bundle.dispose();
		},
	};
}
