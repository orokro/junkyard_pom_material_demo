/**
 * ============================================================================
 * arena/three/demo.js
 * ----------------------------------------------------------------------------
 * Orchestration for the Arena POC (Phase 5): generate the arena model, load the
 * parts library, build InstancedMeshes, wire the walk/fly camera (clamped to the
 * playable bounds), the scrolling floor, post-FX, and the debug overlay.
 *
 * Later phases extend the generator (islands/ramps/bridges/tires/barriers); this
 * file only grows the build + overlay calls, not the plumbing.
 * ============================================================================
 */

import { createScene } from "./scene.js";
import { createFlyControls } from "./flyCamera.js";
import { createFloor } from "./floor.js";
import { createPostFX, DEFAULT_POST_SHADER } from "./postfx.js";
import { loadPostFX } from "../settings.js";
import { generateArena } from "../gen/arena.js";
import { makeSurfaceSampler } from "../gen/surface.js";
import { loadArenaLibrary } from "./library.js";
import { buildArena } from "./build.js";
import { createOverlay } from "../ui/overlay.js";

const EYE_HEIGHT = 1.7;

/**
 * @typedef {object} DemoApi
 * @property {(key: string, value: *) => void} applyRuntime
 * @property {() => void} resetView
 * @property {(on: boolean) => void} setPostEnabled
 * @property {(code: string) => void} setPostShader
 * @property {import("../gen/arena.js").ArenaModel} model
 * @property {() => void} dispose
 */

/**
 * @param {HTMLCanvasElement} canvas
 * @param {Record<string, *>} runtimeConfig
 * @param {Record<string, *>} worldConfig
 * @param {{ onProgress?:(loaded:number,total:number)=>void, onStats?:(s:*)=>void }} [hooks]
 * @returns {Promise<DemoApi>}
 */
export async function startDemo(canvas, runtimeConfig, worldConfig, hooks = {}) {
	const { onProgress, onStats } = hooks;
	onProgress?.(0, 1);

	// 1) Generate the arena (pure data).
	const model = generateArena(String(worldConfig.seed), worldConfig);
	const surfaceAt = makeSurfaceSampler(model);
	const centerX = (model.bounds.minX + model.bounds.maxX) / 2;
	const centerZ = (model.bounds.minZ + model.bounds.maxZ) / 2;

	// 2) Scene + floor.
	const s = createScene(canvas, runtimeConfig.cameraFov);
	const { renderer, scene, camera } = s;

	// Night HDR skybox + image-based lighting; apply saved lighting settings once loaded.
	const HDR_URL = new URL("../../../assets/skybox/moonless_golf_4k.hdr", import.meta.url).href;
	const applyLighting = () => {
		s.setExposure(runtimeConfig.exposure ?? 1.1);
		s.setEnvIntensity(runtimeConfig.envIntensity ?? 1.4);
		s.setBackgroundIntensity(runtimeConfig.bgIntensity ?? 1.0);
		s.setHemiIntensity(runtimeConfig.hemiIntensity ?? 0.12);
		s.setSunIntensity(runtimeConfig.sunIntensity ?? 0.5);
		s.setBackgroundVisible(runtimeConfig.showBackground !== false);
	};
	s.applyHDR(HDR_URL).then(applyLighting).catch((e) => { console.warn("[arena] HDR load failed:", e); applyLighting(); });

	const maxAniso = renderer.capabilities.getMaxAnisotropy();
	const floor = await createFloor(maxAniso, runtimeConfig.floorTileMeters);
	floor.setVisible(Boolean(runtimeConfig.floorVisible));
	scene.add(floor.mesh);

	// 3) Load parts + build instanced meshes.
	const { registry } = await loadArenaLibrary(maxAniso, (loaded, total) => onProgress?.(loaded, total));
	const build = buildArena(model, registry);
	scene.add(build);

	// 4) Camera (clamped to playable bounds).
	const controls = createFlyControls(camera, canvas, {
		speed: runtimeConfig.cameraSpeed,
		walkSpeed: runtimeConfig.walkSpeed,
		eyeHeight: EYE_HEIGHT,
		getSurfaceHeight: surfaceAt,
		startWalking: true,
		bounds: model.bounds,
		boundsMargin: 0.8,
	});

	/** @returns {void} Spawn at arena center, looking north (−Z). */
	function resetView() {
		controls.placeLookingAt({ x: centerX, y: EYE_HEIGHT, z: centerZ }, { x: centerX, y: EYE_HEIGHT, z: centerZ - 10 });
	}
	resetView();

	// 5) Post-FX.
	const post = createPostFX(renderer);
	const savedPost = loadPostFX();
	post.setShader(savedPost.code || DEFAULT_POST_SHADER);
	post.setEnabled(Boolean(savedPost.enabled));
	post.setSize(window.innerWidth, window.innerHeight);
	s.setResizeHook((w, h) => post.setSize(w, h));

	// 6) Debug overlay.
	const overlay = createOverlay(document.getElementById("app"));
	overlay.update(model);
	overlay.setVisible(Boolean(runtimeConfig.debugOverlay));

	let statAccum = 0;
	s.setUpdate((dt) => {
		controls.update(dt);
		floor.update(camera);
		statAccum += dt;
		if (statAccum >= 0.1) {
			statAccum = 0;
			onStats?.({ walking: controls.isWalking(), x: camera.position.x, z: camera.position.z, dims: model.dims });
		}
	});
	s.setRenderOverride((dt) => post.render(scene, camera, dt));
	s.start();

	return {
		model,
		applyRuntime(key, value) {
			switch (key) {
				case "walkSpeed": controls.setWalkSpeed(value); break;
				case "cameraSpeed": controls.setSpeed(value); break;
				case "cameraFov": s.setFov(value); break;
				case "floorVisible": floor.setVisible(Boolean(value)); break;
				case "floorTileMeters": floor.setTile(value); break;
				case "debugOverlay": overlay.setVisible(Boolean(value)); break;
				case "exposure": s.setExposure(value); break;
				case "envIntensity": s.setEnvIntensity(value); break;
				case "bgIntensity": s.setBackgroundIntensity(value); break;
				case "hemiIntensity": s.setHemiIntensity(value); break;
				case "sunIntensity": s.setSunIntensity(value); break;
				case "showBackground": s.setBackgroundVisible(Boolean(value)); break;
				default: break;
			}
		},
		resetView,
		setPostEnabled(on) { post.setEnabled(on); },
		setPostShader(code) { post.setShader(code); },
		dispose() {
			controls.dispose();
			post.dispose();
			overlay.dispose();
			scene.remove(build);
			build.traverse((o) => {
				if (o.isInstancedMesh) o.dispose?.();
			});
			scene.remove(floor.mesh);
			floor.dispose();
			s.dispose();
		},
	};
}
