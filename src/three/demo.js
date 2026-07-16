/**
 * ============================================================================
 * three/demo.js
 * ----------------------------------------------------------------------------
 * Phase 3.3 demo orchestration: streams an infinite junkyard around the fly
 * camera. Loads textures + tile registry, builds the global height field, and
 * hands them to the chunk manager which generates/disposes chunks by render
 * distance. Includes the scrolling dirt floor, debug material toggles, and a
 * live HUD stats line.
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
import { createChunkManager } from "../gen/chunkManager.js";

const SPAWN_X = 6;
const SPAWN_Z = 0;
const PRIME_BUDGET = 48; // chunks generated up-front (nearest first) before first frame

/**
 * @typedef {object} DemoApi
 * @property {(key: string, value: *) => void} applyRuntime
 * @property {() => void} resetView
 * @property {() => void} dispose
 */

/**
 * Boot the streaming junkyard demo.
 * @param {HTMLCanvasElement} canvas
 * @param {Record<string, *>} runtime Runtime config (live sidebar).
 * @param {Record<string, *>} worldConfig World-generation config.
 * @param {{ onProgress?: (l: number, t: number) => void, onStats?: (s: {active: number, pending: number, x: number, z: number}) => void }} [hooks]
 * @returns {Promise<DemoApi>}
 */
export async function startDemo(canvas, runtime, worldConfig, hooks = {}) {
	const bundle = createScene(canvas, runtime.cameraFov ?? 70);
	const { renderer, scene, camera } = bundle;
	const maxAniso = renderer.capabilities.getMaxAnisotropy();

	// Textures → four POM materials for per-block variety.
	const tiles = await loadAllTiles(maxAniso, hooks.onProgress);
	const poms = tiles.map((t) => createPomMaterial(t, runtime));
	const materials = poms.map((p) => p.material);

	const { registry } = await loadTileRegistry();
	const heightField = createHeightField(worldConfig);

	// Debug materials (neutral flat-shaded + wireframe).
	const flatMat = new THREE.MeshStandardMaterial({ color: 0x9aa4b2, metalness: 0.1, roughness: 0.85, flatShading: true });
	const wireMat = new THREE.MeshBasicMaterial({ color: 0x00ff88, wireframe: true });
	const currentMode = () => (runtime.debugWireframe ? "wire" : runtime.debugFlat ? "flat" : "pom");
	/** @param {*} chunk Apply the current material mode to a chunk's meshes. */
	function applyModeToChunk(chunk) {
		const mode = currentMode();
		for (const m of chunk.group.children) {
			if (!m.userData.pomMat) m.userData.pomMat = m.material;
			m.material = mode === "wire" ? wireMat : mode === "flat" ? flatMat : m.userData.pomMat;
		}
	}

	// Chunk streaming.
	const manager = createChunkManager(scene, { worldConfig, heightField, registry, materials }, {
		renderDistance: worldConfig.renderDistance,
		budget: 2,
		onChunkCreated: applyModeToChunk,
	});

	// Scrolling dirt floor.
	const floor = await createFloor(maxAniso, runtime.floorTileMeters ?? 8);
	floor.setVisible(runtime.floorVisible ?? true);
	scene.add(floor.mesh);

	// Bilinear surface height from the height field — the walker sticks to this
	// (matches the ramp/flat tile tops; no raycast needed).
	const getSurfaceHeight = (x, z) => {
		const cx = Math.floor(x / 3) * 3;
		const cz = Math.floor(z / 3) * 3;
		const u = (x - cx) / 3;
		const v = (z - cz) / 3;
		const h00 = heightField.heightAt(cx, cz);
		const h10 = heightField.heightAt(cx + 3, cz);
		const h01 = heightField.heightAt(cx, cz + 3);
		const h11 = heightField.heightAt(cx + 3, cz + 3);
		const a = h00 + (h10 - h00) * u;
		const b = h01 + (h11 - h01) * u;
		return a + (b - a) * v;
	};

	// Spawn at the western edge, at eye height, facing east (+X).
	const groundH = getSurfaceHeight(SPAWN_X, SPAWN_Z);
	const homePos = new THREE.Vector3(SPAWN_X, groundH + 1.7, SPAWN_Z);
	const homeTarget = new THREE.Vector3(SPAWN_X + 80, groundH + 1.7, SPAWN_Z);
	const controls = createFlyControls(camera, canvas, {
		speed: runtime.cameraSpeed ?? 18,
		walkSpeed: runtime.walkSpeed ?? 4,
		eyeHeight: 1.7,
		getSurfaceHeight,
		startWalking: true,
	});
	controls.placeLookingAt(homePos, homeTarget);

	// Prime the chunks around spawn before the first frame.
	manager.update(camera.position, PRIME_BUDGET);

	let statsClock = 0;
	bundle.setUpdate((dt) => {
		controls.update(dt);
		floor.update(camera);
		manager.update(camera.position);
		statsClock += dt;
		if (statsClock >= 0.25) {
			statsClock = 0;
			const s = manager.stats();
			hooks.onStats?.({
				active: s.active,
				pending: s.pending,
				x: camera.position.x,
				z: camera.position.z,
				walking: controls.isWalking(),
			});
		}
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
				case "walkSpeed":
					controls.setWalkSpeed(value);
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
				case "debugFlat":
				case "debugWireframe":
					for (const c of manager.getChunks()) applyModeToChunk(c);
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
			manager.dispose();
			for (const entry of registry.values()) entry.geometry.dispose();
			for (const m of materials) m.dispose();
			for (const t of tiles) {
				t.albedo.dispose();
				t.normal.dispose();
				t.metal.dispose();
				t.rough.dispose();
				t.depth.dispose();
			}
			flatMat.dispose();
			wireMat.dispose();
			floor.dispose();
			bundle.dispose();
		},
	};
}
