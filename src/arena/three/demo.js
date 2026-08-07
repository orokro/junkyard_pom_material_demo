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

import * as THREE from "three";
import { GLTFExporter } from "three/examples/jsm/exporters/GLTFExporter.js";
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
 * @property {() => Promise<void>} exportGLB
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

	/**
	 * Bake the whole generated arena into an exportable Group for GLB export. Every
	 * InstancedMesh's instances are flattened to WORLD space and merged **per material**,
	 * so the GLB carries one mesh (and one texture set) per material instead of thousands
	 * of instance nodes — GLTFExporter chokes on the latter and would duplicate textures.
	 * Per-instance colours (random tent tops) are baked into a vertex-colour attribute so
	 * they survive the merge. The scrolling floor is intentionally excluded.
	 * @returns {{ root: THREE.Group, disposables: THREE.BufferGeometry[], matClones: THREE.Material[], verts: number, meshes: number, capped: boolean }|null}
	 */
	function bakeArena() {
		scene.updateMatrixWorld(true);
		const CAP_VERTS = 8_000_000; // safety ceiling
		/** @type {Map<THREE.Material, {position:number[],normal:number[],uv:number[],color:number[],index:number[],base:number,tag:string,hasColor:boolean}>} */
		const groups = new Map();
		const m4 = new THREE.Matrix4(), im4 = new THREE.Matrix4(), m3 = new THREE.Matrix3();
		const v = new THREE.Vector3(), nv = new THREE.Vector3(), col = new THREE.Color();
		let verts = 0, capped = false;

		/** Append a geometry (transformed by `matrix`) into `material`'s bucket. */
		const bake = (geom, matrix, material, tag, instColor) => {
			const pos = geom.attributes.position;
			if (!pos) return;
			const nrm = geom.attributes.normal, uvA = geom.attributes.uv, idx = geom.index;
			let grp = groups.get(material);
			if (!grp) { grp = { position: [], normal: [], uv: [], color: [], index: [], base: 0, tag, hasColor: false }; groups.set(material, grp); }
			m3.getNormalMatrix(matrix);
			for (let vi = 0; vi < pos.count; vi++) {
				v.fromBufferAttribute(pos, vi).applyMatrix4(matrix); grp.position.push(v.x, v.y, v.z);
				if (nrm) { nv.fromBufferAttribute(nrm, vi).applyMatrix3(m3).normalize(); grp.normal.push(nv.x, nv.y, nv.z); } else grp.normal.push(0, 1, 0);
				if (uvA) grp.uv.push(uvA.getX(vi), uvA.getY(vi)); else grp.uv.push(0, 0);
				if (instColor) { grp.color.push(instColor.r, instColor.g, instColor.b); grp.hasColor = true; } else grp.color.push(1, 1, 1);
			}
			if (idx) for (let k = 0; k < idx.count; k++) grp.index.push(idx.getX(k) + grp.base);
			else for (let vi = 0; vi < pos.count; vi++) grp.index.push(vi + grp.base);
			grp.base += pos.count; verts += pos.count;
		};

		build.traverse((o) => {
			if (capped) return;
			if (/** @type {THREE.InstancedMesh} */ (o).isInstancedMesh) {
				const im = /** @type {THREE.InstancedMesh} */ (o);
				const hasCol = !!im.instanceColor;
				for (let i = 0; i < im.count; i++) {
					if (verts >= CAP_VERTS) { capped = true; return; }
					im.getMatrixAt(i, im4);
					m4.multiplyMatrices(im.matrixWorld, im4);
					if (hasCol) im.getColorAt(i, col);
					bake(im.geometry, m4, im.material, im.name || "part", hasCol ? col : null);
				}
			} else if (/** @type {THREE.Mesh} */ (o).isMesh) {
				if (verts >= CAP_VERTS) { capped = true; return; }
				const mesh = /** @type {THREE.Mesh} */ (o);
				bake(mesh.geometry, mesh.matrixWorld, mesh.material, mesh.name || "mesh", null);
			}
		});

		if (verts === 0) return null;
		const root = new THREE.Group();
		root.name = `arena_${String(worldConfig.seed)}`;
		/** @type {THREE.BufferGeometry[]} */ const disposables = [];
		/** @type {THREE.Material[]} */ const matClones = [];
		let mi = 0;
		for (const [material, grp] of groups) {
			const geometry = new THREE.BufferGeometry();
			geometry.setAttribute("position", new THREE.Float32BufferAttribute(grp.position, 3));
			geometry.setAttribute("normal", new THREE.Float32BufferAttribute(grp.normal, 3));
			geometry.setAttribute("uv", new THREE.Float32BufferAttribute(grp.uv, 2));
			// Only carry vertex colours (and a vertexColors material clone) where instances varied.
			let mat = material;
			if (grp.hasColor) {
				geometry.setAttribute("color", new THREE.Float32BufferAttribute(grp.color, 3));
				mat = material.clone(); mat.vertexColors = true; matClones.push(mat);
			}
			geometry.setIndex(grp.index);
			const mesh = new THREE.Mesh(geometry, mat);
			mesh.name = `${grp.tag}_${mi++}`.replace(/[#.]/g, "_");
			root.add(mesh);
			disposables.push(geometry);
		}
		return { root, disposables, matClones, verts, meshes: groups.size, capped };
	}

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
		/** Bake + download the arena as a binary .glb. Materials/textures stay shared with the
		 *  live scene — only the merged geometries and any vertexColors material clones are disposed. */
		exportGLB() {
			const baked = bakeArena();
			if (!baked) { console.warn("[arena] nothing to export"); return Promise.resolve(); }
			return new Promise((resolve) => {
				const cleanup = () => { baked.disposables.forEach((g) => g.dispose()); baked.matClones.forEach((m) => m.dispose()); };
				new GLTFExporter().parse(
					baked.root,
					(result) => {
						cleanup();
						const blob = new Blob([/** @type {ArrayBuffer} */ (result)], { type: "model/gltf-binary" });
						const url = URL.createObjectURL(blob);
						const a = document.createElement("a");
						a.href = url; a.download = `arena_${String(worldConfig.seed)}.glb`;
						document.body.appendChild(a); a.click(); a.remove();
						setTimeout(() => URL.revokeObjectURL(url), 2000);
						console.info(`[arena] exported ${baked.meshes} material groups (${(baked.verts / 1000).toFixed(0)}k verts)${baked.capped ? " [capped]" : ""}`);
						resolve();
					},
					(err) => { cleanup(); console.error("[arena] export failed:", err); resolve(); },
					{ binary: true }
				);
			});
		},
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
