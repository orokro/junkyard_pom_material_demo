/**
 * ============================================================================
 * craft/three/scene.js
 * ----------------------------------------------------------------------------
 * Renderer + orbit camera + studio lighting for the crafting bay. Uses a PMREM
 * RoomEnvironment for readable metal/paint, and (optionally) the project's HDR
 * skybox for reflections. Exposes a simple update/loop driver.
 * ============================================================================
 */

import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { RoomEnvironment } from "three/examples/jsm/environments/RoomEnvironment.js";
import { RGBELoader } from "three/examples/jsm/loaders/RGBELoader.js";

const BG = 0x1a2230;

/**
 * Build the crafting-bay scene bundle.
 * @param {HTMLCanvasElement} canvas Target canvas.
 * @returns {object} Scene bundle.
 */
export function createScene(canvas) {
	const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: "high-performance" });
	renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
	renderer.setSize(canvas.clientWidth, canvas.clientHeight, false);
	renderer.toneMapping = THREE.ACESFilmicToneMapping;
	renderer.toneMappingExposure = 1.05;

	const scene = new THREE.Scene();
	scene.background = new THREE.Color(BG);

	const camera = new THREE.PerspectiveCamera(45, canvas.clientWidth / canvas.clientHeight, 0.05, 200);
	camera.position.set(2.6, 1.7, 3.4);

	const controls = new OrbitControls(camera, renderer.domElement);
	controls.enableDamping = true;
	controls.dampingFactor = 0.08;
	controls.minDistance = 1.2;
	controls.maxDistance = 12;
	controls.maxPolarAngle = Math.PI * 0.52;
	controls.target.set(0, 0.55, 0);

	// Lighting.
	const hemi = new THREE.HemisphereLight(0xcfe0ff, 0x2a2620, 0.8);
	scene.add(hemi);
	const key = new THREE.DirectionalLight(0xfff2e0, 2.4);
	key.position.set(4, 6, 3);
	scene.add(key);
	const rim = new THREE.DirectionalLight(0x88aaff, 0.7);
	rim.position.set(-4, 3, -4);
	scene.add(rim);

	// IBL.
	const pmrem = new THREE.PMREMGenerator(renderer);
	pmrem.compileEquirectangularShader();
	try {
		scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
	} catch (err) {
		console.warn("[craft] no environment map:", err);
	}

	/** Optionally upgrade IBL to the project HDR (reflections only, keep dark bg). */
	function applyHDR(url) {
		new RGBELoader().load(url, (tex) => {
			const env = pmrem.fromEquirectangular(tex).texture;
			scene.environment?.dispose?.();
			scene.environment = env;
			tex.dispose();
		}, undefined, (e) => console.warn("[craft] HDR load failed:", e?.message || e));
	}

	// Studio floor (subtle disc so the car doesn't float).
	const floor = new THREE.Mesh(
		new THREE.CircleGeometry(6, 64),
		new THREE.MeshStandardMaterial({ color: 0x11161f, roughness: 0.95, metalness: 0.0 })
	);
	floor.rotation.x = -Math.PI / 2;
	floor.position.y = -0.001;
	scene.add(floor);
	const grid = new THREE.GridHelper(12, 24, 0x2a3646, 0x1e2733);
	grid.position.y = 0;
	scene.add(grid);

	let update = () => {};
	const timer = new THREE.Timer();
	let raf = 0;

	function onResize() {
		const w = canvas.clientWidth, h = canvas.clientHeight;
		renderer.setSize(w, h, false);
		camera.aspect = w / h;
		camera.updateProjectionMatrix();
	}
	window.addEventListener("resize", onResize);

	function tick() {
		raf = requestAnimationFrame(tick);
		timer.update();
		const dt = Math.min(timer.getDelta(), 0.1);
		controls.update();
		update(dt, timer.getElapsed());
		renderer.render(scene, camera);
	}

	return {
		renderer, scene, camera, controls, applyHDR,
		setUpdate(fn) { update = fn; },
		start() { onResize(); tick(); },
		dispose() { cancelAnimationFrame(raf); window.removeEventListener("resize", onResize); controls.dispose(); renderer.dispose(); pmrem.dispose(); },
	};
}
