/**
 * ============================================================================
 * three/scene.js
 * ----------------------------------------------------------------------------
 * Core ThreeJS boilerplate: renderer, sky-blue scene, lighting + a PMREM
 * environment (for readable metal/roughness), camera, resize handling, and a
 * minimal render-loop driver. Deliberately generic so later phases reuse it.
 * ============================================================================
 */

import * as THREE from "three";
import { RoomEnvironment } from "three/examples/jsm/environments/RoomEnvironment.js";

const SKY = 0x8ec5ff;

/**
 * @typedef {object} SceneBundle
 * @property {THREE.WebGLRenderer} renderer
 * @property {THREE.Scene} scene
 * @property {THREE.PerspectiveCamera} camera
 * @property {(fov: number) => void} setFov
 * @property {(fn: (dt: number, elapsed: number) => void) => void} setUpdate
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

	// Lighting: a hemisphere fill (sky/ground) plus a directional "sun" so the
	// POM relief reads across the surface.
	const hemi = new THREE.HemisphereLight(0xbfd8ff, 0x55503f, 0.9);
	scene.add(hemi);
	const sun = new THREE.DirectionalLight(0xfff2e0, 2.2);
	sun.position.set(30, 50, 20);
	scene.add(sun);

	// Image-based lighting for believable metal/roughness response.
	try {
		const pmrem = new THREE.PMREMGenerator(renderer);
		const envTex = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
		scene.environment = envTex;
		pmrem.dispose();
	} catch (err) {
		console.warn("[jy] environment map unavailable, lights only:", err);
	}

	/** @type {(dt: number, elapsed: number) => void} */
	let update = () => {};
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
	}
	window.addEventListener("resize", onResize);

	/** @returns {void} Frame loop. */
	function tick() {
		raf = requestAnimationFrame(tick);
		timer.update();
		const dt = Math.min(timer.getDelta(), 0.1);
		update(dt, timer.getElapsed());
		renderer.render(scene, camera);
	}

	return {
		renderer,
		scene,
		camera,
		setFov(next) {
			camera.fov = next;
			camera.updateProjectionMatrix();
		},
		setUpdate(fn) {
			update = fn;
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
		},
	};
}
