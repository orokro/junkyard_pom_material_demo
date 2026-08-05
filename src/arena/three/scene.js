/**
 * ============================================================================
 * arena/three/scene.js
 * ----------------------------------------------------------------------------
 * Core ThreeJS boilerplate: renderer, sky-blue scene, lighting + a PMREM
 * environment (for readable metal/roughness), camera, resize handling, and a
 * minimal render-loop driver. Independent copy for the Arena POC.
 * ============================================================================
 */

import * as THREE from "three";
import { RoomEnvironment } from "three/examples/jsm/environments/RoomEnvironment.js";
import { RGBELoader } from "three/examples/jsm/loaders/RGBELoader.js";

const SKY = 0x8ec5ff;

/**
 * @typedef {object} SceneBundle
 * @property {THREE.WebGLRenderer} renderer
 * @property {THREE.Scene} scene
 * @property {THREE.PerspectiveCamera} camera
 * @property {(fov: number) => void} setFov
 * @property {(fn: (dt: number, elapsed: number) => void) => void} setUpdate
 * @property {(fn: (dt: number) => void) => void} setRenderOverride
 * @property {(fn: (w: number, h: number) => void) => void} setResizeHook
 * @property {() => void} start
 * @property {() => void} dispose
 */

/**
 * Create the renderer/scene/camera bundle bound to a canvas.
 * @param {HTMLCanvasElement} canvas Target canvas.
 * @param {number} [fov] Initial vertical FOV.
 * @returns {SceneBundle} Scene bundle.
 */
export function createScene(canvas, fov = 70) {
	const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: "high-performance" });
	renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
	renderer.setSize(window.innerWidth, window.innerHeight, false);
	renderer.toneMapping = THREE.ACESFilmicToneMapping;
	renderer.toneMappingExposure = 1.0;

	const scene = new THREE.Scene();
	scene.background = new THREE.Color(SKY);

	const camera = new THREE.PerspectiveCamera(fov, window.innerWidth / window.innerHeight, 0.1, 6000);

	// Lighting: a hemisphere fill (sky/ground) plus a directional "sun".
	const hemi = new THREE.HemisphereLight(0xbfd8ff, 0x55503f, 0.9);
	scene.add(hemi);
	const sun = new THREE.DirectionalLight(0xfff2e0, 2.2);
	sun.position.set(30, 50, 20);
	scene.add(sun);

	// Image-based lighting: RoomEnvironment as a fallback until an HDR is applied.
	const pmrem = new THREE.PMREMGenerator(renderer);
	pmrem.compileEquirectangularShader();
	try {
		scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
	} catch (err) {
		console.warn("[arena] environment map unavailable, lights only:", err);
	}
	/** @type {THREE.Texture|null} */
	let hdrEquirect = null;

	/**
	 * Load an equirectangular HDR and use it as the IBL environment + (optionally) the
	 * sky background. Dims the analytic hemi/sun so the HDR drives the look.
	 * @param {string} url @param {{ background?: boolean }} [opts]
	 */
	function applyHDR(url, opts = {}) {
		return new Promise((resolve, reject) => {
			new RGBELoader().load(url, (tex) => {
				try {
					const env = pmrem.fromEquirectangular(tex).texture;
					if (scene.environment) scene.environment.dispose?.();
					scene.environment = env;
					if (opts.background !== false) {
						tex.mapping = THREE.EquirectangularReflectionMapping;
						hdrEquirect = tex;
						scene.background = tex;
					} else {
						tex.dispose();
					}
					// Night look: let the HDR carry it, keep a faint analytic fill.
					hemi.intensity = 0.12;
					sun.intensity = 0.5;
					resolve(env);
				} catch (e) { reject(e); }
			}, undefined, reject);
		});
	}

	/** @type {(dt: number, elapsed: number) => void} */
	let update = () => {};
	/** @type {((dt: number) => void)|null} */
	let renderOverride = null;
	/** @type {((w: number, h: number) => void)|null} */
	let resizeHook = null;
	const timer = new THREE.Timer();
	let running = false;
	let raf = 0;

	/** @returns {void} Resize the renderer/camera to the window. */
	function onResize() {
		const w = window.innerWidth;
		const h = window.innerHeight;
		renderer.setSize(w, h, false);
		camera.aspect = w / h;
		camera.updateProjectionMatrix();
		resizeHook?.(w, h);
	}
	window.addEventListener("resize", onResize);

	/** @returns {void} Frame loop. */
	function tick() {
		raf = requestAnimationFrame(tick);
		timer.update();
		const dt = Math.min(timer.getDelta(), 0.1);
		update(dt, timer.getElapsed());
		if (renderOverride) renderOverride(dt);
		else renderer.render(scene, camera);
	}

	return {
		renderer,
		scene,
		camera,
		applyHDR,
		setFov(next) {
			camera.fov = next;
			camera.updateProjectionMatrix();
		},
		/** Live lighting controls (driven from the sidebar). */
		setExposure(v) { renderer.toneMappingExposure = v; },
		setEnvIntensity(v) { scene.environmentIntensity = v; },
		setBackgroundIntensity(v) { scene.backgroundIntensity = v; },
		setHemiIntensity(v) { hemi.intensity = v; },
		setSunIntensity(v) { sun.intensity = v; },
		setBackgroundVisible(on) { scene.background = on ? (hdrEquirect || new THREE.Color(SKY)) : null; },
		setUpdate(fn) {
			update = fn;
		},
		setRenderOverride(fn) {
			renderOverride = fn;
		},
		setResizeHook(fn) {
			resizeHook = fn;
		},
		start() {
			if (running) return;
			running = true;
			tick();
		},
		dispose() {
			cancelAnimationFrame(raf);
			running = false;
			window.removeEventListener("resize", onResize);
			renderer.dispose();
			if (scene.environment) scene.environment.dispose();
			if (hdrEquirect) hdrEquirect.dispose();
			pmrem.dispose();
		},
	};
}
