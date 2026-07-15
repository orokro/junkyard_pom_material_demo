/**
 * ============================================================================
 * three/demo.js
 * ----------------------------------------------------------------------------
 * Phase 3.2 demo orchestration: loads the tile registry and generates a single
 * chunk from the global noise height field, rendered with per-block texture
 * variety (four POM materials, instanced per geometry+set). Includes the
 * scrolling dirt floor and fly camera.
 *
 * Returns an API the app uses to push runtime-config changes (POM, camera,
 * FOV, floor), reset the view, and tear everything down.
 * ============================================================================
 */

import * as THREE from "three";
import { createScene } from "./scene.js";
import { createFlyControls } from "./flyCamera.js";
import { loadAllTiles } from "./textures.js";
import { createPomMaterial } from "./pomMaterial.js";
import { createFloor } from "./floor.js";
import { loadTileRegistry } from "./tiles.js";
import { createHeightField } from "../gen/heightField.js";
import { generateChunk } from "../gen/chunk.js";

/**
 * @typedef {object} DemoApi
 * @property {(key: string, value: *) => void} applyRuntime
 * @property {() => void} resetView
 * @property {() => void} dispose
 */

/**
 * Boot the Phase 3.2 single-chunk demo.
 * @param {HTMLCanvasElement} canvas Target canvas.
 * @param {Record<string, *>} runtime Runtime config (mutated live by the sidebar).
 * @param {Record<string, *>} worldConfig World-generation config (seed, noise, chunk).
 * @param {(loaded: number, total: number) => void} [onProgress] Texture progress.
 * @returns {Promise<DemoApi>} Demo control API.
 */
export async function startDemo(canvas, runtime, worldConfig, onProgress) {
	const bundle = createScene(canvas, runtime.cameraFov ?? 70);
	const { renderer, scene, camera } = bundle;
	const maxAniso = renderer.capabilities.getMaxAnisotropy();

	// Four POM materials, one per tile set, for per-block variety.
	const tiles = await loadAllTiles(maxAniso, onProgress);
	const poms = tiles.map((t) => createPomMaterial(t, runtime));
	const materials = poms.map((p) => p.material);

	// Tile geometry registry.
	const { registry } = await loadTileRegistry();

	// Generate one chunk from the height field.
	const heightField = createHeightField(worldConfig);
	const chunk = generateChunk(0, 0, { worldConfig, heightField, registry, materials });
	scene.add(chunk.group);
	console.info(`[jy] chunk(0,0): ${chunk.instanceCount} blocks, max height ${chunk.maxHeight} m`);

	const cs = Math.round(worldConfig.chunkSize);
	const spanM = cs * 3;
	const centerX = spanM / 2;
	const centerZ = spanM / 2;

	// Reference grid at the chunk footprint.
	const grid = new THREE.GridHelper(Math.max(60, spanM * 2), 24, 0x2b3441, 0x1c232d);
	grid.position.set(centerX, 0.02, centerZ);
	scene.add(grid);

	// Scrolling dirt floor.
	const floor = await createFloor(maxAniso, runtime.floorTileMeters ?? 8);
	floor.setVisible(runtime.floorVisible ?? true);
	scene.add(floor.mesh);

	// Frame the chunk.
	const homePos = new THREE.Vector3(centerX, chunk.maxHeight + 25, centerZ + spanM + 55);
	const homeTarget = new THREE.Vector3(centerX, chunk.maxHeight * 0.4, centerZ);

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
					for (const p of poms) p.applyRuntime({ [key]: value });
					break;
				case "cameraSpeed":
					controls.setSpeed(value);
					break;
				case "cameraFov":
					bundle.setFov(value);
					break;
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
			chunk.dispose();
			for (const entry of registry.values()) entry.geometry.dispose();
			for (const m of materials) m.dispose();
			for (const t of tiles) {
				t.albedo.dispose();
				t.normal.dispose();
				t.metal.dispose();
				t.rough.dispose();
				t.depth.dispose();
			}
			grid.geometry.dispose();
			floor.dispose();
			bundle.dispose();
		},
	};
}
