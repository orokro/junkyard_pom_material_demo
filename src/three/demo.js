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
import { loadAllTiles, loadBiomeSet } from "./textures.js";
import { createPomMaterial } from "./pomMaterial.js";
import { createFloor } from "./floor.js";
import { createWallEdge } from "./wallEdge.js";
import { loadTileRegistry } from "./tiles.js";
import { loadStructureLibrary } from "./structures.js";
import { createHeightField } from "../gen/heightField.js";
import { createChunkManager } from "../gen/chunkManager.js";
import { GLTFExporter } from "three/examples/jsm/exporters/GLTFExporter.js";
import { createPostFX, DEFAULT_POST_SHADER } from "./postfx.js";
import { loadPostFX } from "../settings.js";

const SPAWN_X = 6;
const SPAWN_Z = 0;
const WALL_X = 0; // yard's western edge — the boundary wall + camera clamp live here
const PRIME_BUDGET = 48;
const EXPORT_RADIUS_M = 160; // slice of terrain around the camera to export

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
	const rustTile = await loadBiomeSet("jy_rust", maxAniso);
	const tireTile = await loadBiomeSet("jy_tires", maxAniso);
	const allTiles = [...tiles, rustTile, tireTile];
	const poms = allTiles.map((t) => createPomMaterial(t, runtime));
	// Texture families: 4 default sets + one rust + one tire set. Chunk gen picks
	// a family per cell from the biome scalars (see chunk.js pickFamily).
	const materials = { def: [poms[0].material, poms[1].material, poms[2].material, poms[3].material], rust: poms[4].material, tire: poms[5].material };

	const { registry } = await loadTileRegistry();
	const structures = await loadStructureLibrary();
	const heightField = createHeightField(worldConfig);

	const flatMat = new THREE.MeshStandardMaterial({ color: 0x9aa4b2, metalness: 0.1, roughness: 0.85, flatShading: true });
	const wireMat = new THREE.MeshBasicMaterial({ color: 0x00ff88, wireframe: true });
	const currentMode = () => (runtime.debugWireframe ? "wire" : runtime.debugFlat ? "flat" : "pom");
	/** @param {*} chunk */
	function applyModeToChunk(chunk) {
		const mode = currentMode();
		for (const m of chunk.group.children) {
			if (!m.isInstancedMesh) continue; // skip structure clones — terrain only
			if (!m.userData.pomMat) m.userData.pomMat = m.material;
			m.material = mode === "wire" ? wireMat : mode === "flat" ? flatMat : m.userData.pomMat;
		}
	}

	const manager = createChunkManager(scene, { worldConfig, heightField, registry, materials, structures }, {
		renderDistance: worldConfig.renderDistance,
		budget: 6,
		timeBudgetMs: 4,
		onChunkCreated: applyModeToChunk,
	});

	const floor = await createFloor(maxAniso, runtime.floorTileMeters ?? 8);
	floor.setVisible(runtime.floorVisible ?? true);
	scene.add(floor.mesh);

	// Infinite boundary wall along the western edge (faked like the floor).
	const chunkWorld = Math.round(worldConfig.chunkSize) * 3;
	const wallReach = Math.max(1, Math.round(worldConfig.renderDistance)) * chunkWorld;
	const wall = await createWallEdge(WALL_X, wallReach, wallReach);
	wall.setVisible(runtime.wallVisible !== false);
	scene.add(wall.mesh);

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
		minX: WALL_X + 0.6, // can't cross west through the edge wall
	});
	controls.placeLookingAt(homePos, homeTarget);

	manager.update(camera.position, PRIME_BUDGET, false); // prime fully during load

	// Post-processing pipeline (off by default; state persisted).
	const post = createPostFX(renderer);
	post.setSize(window.innerWidth, window.innerHeight);
	const savedPost = loadPostFX();
	post.setShader(savedPost.code || DEFAULT_POST_SHADER);
	post.setEnabled(savedPost.enabled);
	bundle.setRenderOverride((dt) => post.render(scene, camera, dt));
	bundle.setResizeHook((w, h) => post.setSize(w, h));

	let statsClock = 0;
	bundle.setUpdate((dt) => {
		controls.update(dt);
		floor.update(camera);
		wall.update(camera);
		manager.update(camera.position);
		statsClock += dt;
		if (statsClock >= 0.25) {
			statsClock = 0;
			const s = manager.stats();
			hooks.onStats?.({ active: s.active, pending: s.pending, x: camera.position.x, z: camera.position.z, walking: controls.isWalking(), biome: heightField.biomesAt(camera.position.x, camera.position.z) });
		}
	});
	bundle.start();

	/**
	 * Bake nearby chunks into an exportable Group: terrain instances + structure
	 * meshes are flattened to world space and merged **per material**, so the GLB
	 * keeps distinct biome terrain (default / rust / tire) and structure materials
	 * with their textures — instead of one generic blob. GLTFExporter chokes on
	 * thousands of InstancedMesh nodes, so we bake to one Mesh per material.
	 * @returns {{ root: THREE.Group, disposables: THREE.BufferGeometry[], verts: number, meshes: number, capped: boolean }|null}
	 */
	function bakeNearby() {
		const chunks = manager.getChunksNear(camera.position.x, camera.position.z, EXPORT_RADIUS_M);
		if (chunks.length === 0) return null;
		scene.updateMatrixWorld(true);

		const CAP_VERTS = 6_000_000; // safety ceiling on baked vertices
		/** @type {Map<THREE.Material, {position: number[], normal: number[], uv: number[], index: number[], base: number, tag: string}>} */
		const groups = new Map();
		const m4 = new THREE.Matrix4();
		const im4 = new THREE.Matrix4();
		const m3 = new THREE.Matrix3();
		const v = new THREE.Vector3();
		const n = new THREE.Vector3();
		let verts = 0;
		let capped = false;

		/** Append a geometry (transformed by `matrix`) into `material`'s bucket. */
		function bake(geom, matrix, material, tag) {
			const pos = geom.attributes.position;
			if (!pos) return;
			const nrm = geom.attributes.normal;
			const uvA = geom.attributes.uv;
			const idx = geom.index;
			let grp = groups.get(material);
			if (!grp) {
				grp = { position: [], normal: [], uv: [], index: [], base: 0, tag };
				groups.set(material, grp);
			}
			m3.getNormalMatrix(matrix);
			for (let vi = 0; vi < pos.count; vi++) {
				v.fromBufferAttribute(pos, vi).applyMatrix4(matrix);
				grp.position.push(v.x, v.y, v.z);
				if (nrm) {
					n.fromBufferAttribute(nrm, vi).applyMatrix3(m3).normalize();
					grp.normal.push(n.x, n.y, n.z);
				} else grp.normal.push(0, 1, 0);
				if (uvA) grp.uv.push(uvA.getX(vi), uvA.getY(vi));
				else grp.uv.push(0, 0);
			}
			if (idx) for (let k = 0; k < idx.count; k++) grp.index.push(idx.getX(k) + grp.base);
			else for (let vi = 0; vi < pos.count; vi++) grp.index.push(vi + grp.base);
			grp.base += pos.count;
			verts += pos.count;
		}

		for (const c of chunks) {
			if (capped) break;
			c.group.traverse((o) => {
				if (capped) return;
				if (/** @type {THREE.InstancedMesh} */ (o).isInstancedMesh) {
					const im = /** @type {THREE.InstancedMesh} */ (o);
					const mat = im.userData.pomMat || im.material; // real POM even in debug view
					for (let i = 0; i < im.count; i++) {
						if (verts >= CAP_VERTS) { capped = true; return; }
						im.getMatrixAt(i, im4);
						m4.multiplyMatrices(im.matrixWorld, im4);
						bake(im.geometry, m4, mat, "terrain");
					}
				} else if (/** @type {THREE.Mesh} */ (o).isMesh) {
					if (verts >= CAP_VERTS) { capped = true; return; }
					const mesh = /** @type {THREE.Mesh} */ (o);
					bake(mesh.geometry, mesh.matrixWorld, mesh.material, mesh.name || "structure");
				}
			});
		}

		if (verts === 0) return null;
		const root = new THREE.Group();
		root.name = `jy_world_${String(worldConfig.seed)}`;
		/** @type {THREE.BufferGeometry[]} */ const disposables = [];
		let mi = 0;
		for (const [material, grp] of groups) {
			const geometry = new THREE.BufferGeometry();
			geometry.setAttribute("position", new THREE.Float32BufferAttribute(grp.position, 3));
			geometry.setAttribute("normal", new THREE.Float32BufferAttribute(grp.normal, 3));
			geometry.setAttribute("uv", new THREE.Float32BufferAttribute(grp.uv, 2));
			geometry.setIndex(grp.index);
			const mesh = new THREE.Mesh(geometry, material);
			mesh.name = `${grp.tag}_${mi++}`;
			root.add(mesh);
			disposables.push(geometry);
		}
		return { root, disposables, verts, meshes: groups.size, capped };
	}

	return {
		applyRuntime(key, value) {
			switch (key) {
				case "pomStrength":
				case "pomSteps":
				case "pomInvertDepth":
				case "rustTint":
				case "tireDesat":
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
				case "wallVisible":
					wall.setVisible(value);
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
		setPostEnabled(on) {
			post.setEnabled(on);
		},
		setPostShader(code) {
			post.setShader(code);
		},
		exportGLB() {
			const baked = bakeNearby();
			if (!baked) return;
			// Materials stay shared with the live scene — dispose only the merged
			// geometries we created, never the materials/textures still in use.
			const cleanup = () => baked.disposables.forEach((g) => g.dispose());
			new GLTFExporter().parse(
				baked.root,
				(result) => {
					cleanup();
					const blob = new Blob([/** @type {ArrayBuffer} */ (result)], { type: "model/gltf-binary" });
					const url = URL.createObjectURL(blob);
					const a = document.createElement("a");
					a.href = url;
					a.download = `jy_world_${String(worldConfig.seed)}.glb`;
					document.body.appendChild(a);
					a.click();
					a.remove();
					setTimeout(() => URL.revokeObjectURL(url), 2000);
					console.info(`[jy] exported ${baked.meshes} material groups (${(baked.verts / 1000).toFixed(0)}k verts)${baked.capped ? " [capped]" : ""}`);
				},
				(err) => {
					cleanup();
					console.error("[jy] export failed:", err);
				},
				{ binary: true }
			);
		},
		dispose() {
			controls.dispose();
			manager.dispose();
			for (const entry of registry.values()) entry.geometry.dispose();
			for (const p of poms) p.material.dispose();
			for (const t of allTiles) {
				t.albedo.dispose();
				t.normal.dispose();
				t.metal.dispose();
				t.rough.dispose();
				t.depth.dispose();
			}
			flatMat.dispose();
			wireMat.dispose();
			floor.dispose();
			wall.dispose();
			post.dispose();
			bundle.dispose();
		},
	};
}
