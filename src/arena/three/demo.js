/**
 * ============================================================================
 * arena/three/demo.js
 * ----------------------------------------------------------------------------
 * Orchestration for the Arena POC: wires the scene, the scrolling arena floor,
 * the walk/fly camera, and the post-processing pass together and exposes a
 * small control API to main.js (live runtime tweaks, reset view, post-FX).
 *
 * This is the arena equivalent of the junkyard's three/demo.js. It shares no
 * code with the junkyard — it only composes the arena's own modules. Arena
 * generation (seed-driven geometry) will grow inside here; for now the "world"
 * is an open, walkable infinite floor.
 * ============================================================================
 */

import { createScene } from "./scene.js";
import { createFlyControls } from "./flyCamera.js";
import { createFloor } from "./floor.js";
import { createPostFX, DEFAULT_POST_SHADER } from "./postfx.js";
import { loadPostFX } from "../settings.js";

const EYE_HEIGHT = 1.7;

/**
 * @typedef {object} DemoApi
 * @property {(key: string, value: *) => void} applyRuntime Apply a live runtime tweak.
 * @property {() => void} resetView Return to the spawn pose.
 * @property {(on: boolean) => void} setPostEnabled Toggle post-processing.
 * @property {(code: string) => void} setPostShader Apply a post-FX fragment shader.
 * @property {boolean} usingFallbackFloor True if the arena_floor texture set is missing.
 * @property {() => void} dispose Tear everything down.
 */

/**
 * Start the arena demo on a canvas.
 * @param {HTMLCanvasElement} canvas Target canvas.
 * @param {Record<string, *>} runtimeConfig Live runtime config (mutated by the sidebar).
 * @param {Record<string, *>} worldConfig Assembled world config (seed, arena size, …).
 * @param {{ onProgress?: (loaded: number, total: number) => void, onStats?: (s: *) => void }} [hooks]
 * @returns {Promise<DemoApi>} Control API.
 */
export async function startDemo(canvas, runtimeConfig, worldConfig, hooks = {}) {
	const { onProgress, onStats } = hooks;
	onProgress?.(0, 1);

	const s = createScene(canvas, runtimeConfig.cameraFov);
	const { renderer, scene, camera } = s;
	const maxAniso = renderer.capabilities.getMaxAnisotropy();

	// Infinite scrolling arena floor (no bounds, no boundary wall).
	const floor = await createFloor(maxAniso, runtimeConfig.floorTileMeters);
	floor.setVisible(Boolean(runtimeConfig.floorVisible));
	scene.add(floor.mesh);
	onProgress?.(1, 1);

	// Walk/fly camera. Flat surface at Y=0 → walk mode rides eye height above 0.
	const controls = createFlyControls(camera, canvas, {
		speed: runtimeConfig.cameraSpeed,
		walkSpeed: runtimeConfig.walkSpeed,
		eyeHeight: EYE_HEIGHT,
		getSurfaceHeight: () => 0,
		startWalking: true,
	});

	// Post-processing (same default shader + toggle as the junkyard).
	const post = createPostFX(renderer);
	const savedPost = loadPostFX();
	post.setShader(savedPost.code || DEFAULT_POST_SHADER);
	post.setEnabled(Boolean(savedPost.enabled));
	post.setSize(window.innerWidth, window.innerHeight);
	s.setResizeHook((w, h) => post.setSize(w, h));

	/** @returns {void} Place the camera at spawn (origin), looking east (+X). */
	function resetView() {
		controls.placeLookingAt({ x: 0, y: EYE_HEIGHT, z: 0 }, { x: 1, y: EYE_HEIGHT, z: 0 });
	}
	resetView();

	let statAccum = 0;
	s.setUpdate((dt) => {
		controls.update(dt);
		floor.update(camera);
		statAccum += dt;
		if (statAccum >= 0.1) {
			statAccum = 0;
			onStats?.({
				walking: controls.isWalking(),
				x: camera.position.x,
				z: camera.position.z,
			});
		}
	});
	s.setRenderOverride((dt) => post.render(scene, camera, dt));
	s.start();

	return {
		applyRuntime(key, value) {
			switch (key) {
				case "walkSpeed":
					controls.setWalkSpeed(value);
					break;
				case "cameraSpeed":
					controls.setSpeed(value);
					break;
				case "cameraFov":
					s.setFov(value);
					break;
				case "floorVisible":
					floor.setVisible(Boolean(value));
					break;
				case "floorTileMeters":
					floor.setTile(value);
					break;
				default:
					break;
			}
		},
		resetView,
		setPostEnabled(on) {
			post.setEnabled(on);
		},
		setPostShader(code) {
			post.setShader(code);
		},
		usingFallbackFloor: floor.usingFallback,
		dispose() {
			controls.dispose();
			post.dispose();
			scene.remove(floor.mesh);
			floor.dispose();
			s.dispose();
		},
	};
}
