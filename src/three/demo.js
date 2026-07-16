/**
 * ============================================================================
 * three/demo.js
 * ----------------------------------------------------------------------------
 * Streaming junkyard demo: textures + tile registry + global height field →
 * chunk manager (generate/dispose by render distance). Scrolling dirt floor,
 * walk/fly camera, debug material toggles, live HUD, and a baked .glb export.
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
import { GLTFExporter } from "three/examples/jsm/exporters/GLTFExporter.js";

const SPAWN_X = 6;
const SPAWN_Z = 0;
const PRIME_BUDGET = 48;
const EXPORT_RADIUS_M = 160; // slice of terrain around the camera to export
const EXPORT_CAP_TILES = 60000; // safety cap on baked tiles (memory)

/**
 * @typedef {object} DemoApi
 * @property {(key: string, value: *) => void} applyRuntime
 * @property {() => void} resetView
 * @property {() => void} exportGLB
 * @property {() => void} dispose
 */

/**
 * Boot the streaming junkyard demo.
 * @param {HTMLCanvasElement} canvas
 * @param {Record<string, *>} runtime
 * @param {Record<string, *>} worldConfig
 * @param {{ onProgress?: (l: number, t: number) => void, onStats?: (s: *) => void }} [hooks]
 * @returns {Promise<DemoApi>}
 */
export async function startDemo(canvas, runtime, worldConfig, hooks = {}) {
	const bundle = createScene(canvas, runtime.cameraFov ?? 70);
	const { renderer, scene, camera } = bundle;
	const maxAniso = renderer.capabilities.getMaxAnisotropy();

	const tiles = await loadAllTiles(maxAniso, hooks.onProgress);
	const poms = tiles.map((t) => createPomMaterial(t, runtime));
	const materials = poms.map((p) => p.material);

	const { registry } = await loadTileRegistry();
	const heightField = createHeightField(worldConfig);

	const flatMat = new THREE.MeshStandardMaterial({ color: 0x9aa4b2, metalness: 0.1, roughness: 0.85, flatShading: true });
	const wireMat = new THREE.MeshBasicMaterial({ color: 0x00ff88, wireframe: true });
	const currentMode = () => (runtime.debugWireframe ? "wire" : runtime.debugFlat ? "flat" : "pom");
	/** @param {*} chunk */
	function applyModeToChunk(chunk) {
		const mode = currentMode();
		for (const m of chunk.group.children) {
			if (!m.userData.pomMat) m.userData.pomMat = m.material;
			m.material = mode === "wire" ? wireMat : mode === "flat" ? flatMat : m.userData.pomMat;
		}
	}

	const manager = createChunkManager(scene, { worldConfig, heightField, registry, materials }, {
		renderDistance: worldConfig.renderDistance,
		budget: 2,
		onChunkCreated: applyModeToChunk,
	});

	const floor = await createFloor(maxAniso, runtime.floorTileMeters ?? 8);
	floor.setVisible(runtime.floorVisible ?? true);
	scene.add(floor.mesh);

	// Bilinear surface height (walker sticks to this — matches ramp/flat tile tops).
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
			hooks.onStats?.({ active: s.active, pending: s.pending, x: camera.position.x, z: camera.position.z, walking: controls.isWalking() });
		}
	});
	bundle.start();

	/**
	 * Bake all instances in the nearby chunks into one merged BufferGeometry.
	 * (GLTFExporter chokes on thousands of InstancedMesh nodes, so we flatten to
	 * a single mesh — the vertex total is small.)
	 * @returns {{ geometry: THREE.BufferGeometry, tiles: number, capped: boolean }|null}
	 */
	function bakeNearby() {
		const chunks = manager.getChunksNear(camera.position.x, camera.position.z, EXPORT_RADIUS_M);
		if (chunks.length === 0) return null;

		/** @type {number[]} */ const position = [];
		/** @type {number[]} */ const normal = [];
		/** @type {number[]} */ const uv = [];
		/** @type {number[]} */ const index = [];
		let vertBase = 0;
		let tiles = 0;
		let capped = false;

		const m4 = new THREE.Matrix4();
		const m3 = new THREE.Matrix3();
		const v = new THREE.Vector3();
		const n = new THREE.Vector3();

		outer: for (const c of chunks) {
			for (const mesh of c.group.children) {
				if (!(/** @type {THREE.InstancedMesh} */ (mesh).isInstancedMesh)) continue;
				const im = /** @type {THREE.InstancedMesh} */ (mesh);
				const g = im.geometry;
				const pos = g.attributes.position;
				const nrm = g.attributes.normal;
				const uvA = g.attributes.uv;
				const idx = g.index;
				for (let i = 0; i < im.count; i++) {
					if (tiles >= EXPORT_CAP_TILES) {
						capped = true;
						break outer;
					}
					im.getMatrixAt(i, m4);
					m3.getNormalMatrix(m4);
					for (let vi = 0; vi < pos.count; vi++) {
						v.fromBufferAttribute(pos, vi).applyMatrix4(m4);
						position.push(v.x, v.y, v.z);
						n.fromBufferAttribute(nrm, vi).applyMatrix3(m3).normalize();
						normal.push(n.x, n.y, n.z);
						if (uvA) uv.push(uvA.getX(vi), uvA.getY(vi));
						else uv.push(0, 0);
					}
					if (idx) {
						for (let k = 0; k < idx.count; k++) index.push(idx.getX(k) + vertBase);
					} else {
						for (let vi = 0; vi < pos.count; vi++) index.push(vi + vertBase);
					}
					vertBase += pos.count;
					tiles++;
				}
			}
		}

		if (tiles === 0) return null;
		const geometry = new THREE.BufferGeometry();
		geometry.setAttribute("position", new THREE.Float32BufferAttribute(position, 3));
		geometry.setAttribute("normal", new THREE.Float32BufferAttribute(normal, 3));
		geometry.setAttribute("uv", new THREE.Float32BufferAttribute(uv, 2));
		geometry.setIndex(index);
		return { geometry, tiles, capped };
	}

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
		exportGLB() {
			const baked = bakeNearby();
			if (!baked) return;
			const mesh = new THREE.Mesh(baked.geometry, new THREE.MeshStandardMaterial({ color: 0x9a8f80, roughness: 0.9, metalness: 0.0 }));
			mesh.name = "junkyard";
			new GLTFExporter().parse(
				mesh,
				(result) => {
					baked.geometry.dispose();
					mesh.material.dispose();
					const blob = new Blob([/** @type {ArrayBuffer} */ (result)], { type: "model/gltf-binary" });
					const url = URL.createObjectURL(blob);
					const a = document.createElement("a");
					a.href = url;
					a.download = `jy_world_${String(worldConfig.seed)}.glb`;
					document.body.appendChild(a);
					a.click();
					a.remove();
					setTimeout(() => URL.revokeObjectURL(url), 2000);
					console.info(`[jy] exported ${baked.tiles} tiles (${(baked.geometry.attributes.position.count / 1000).toFixed(0)}k verts)${baked.capped ? " [capped]" : ""}`);
				},
				(err) => {
					baked.geometry.dispose();
					mesh.material.dispose();
					console.error("[jy] export failed:", err);
				},
				{ binary: true }
			);
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
