/**
 * ============================================================================
 * gen/chunk.js
 * ----------------------------------------------------------------------------
 * Single-chunk generation (Phase 3.2).
 *
 * For each column in the chunk, the global height field gives an integer meter
 * height H. The column is filled with `flat_3` (3 m) bodies, then capped with a
 * `flat_1` or `flat_2` for the H % 3 remainder — giving 1 m vertical detail
 * (the "third-slab" resolution). Ramps come in the next increment.
 *
 * Per-block texture variety: each block hashes `${seed}_${colX}_${colZ}_${y}`
 * to a tile set 0-3, so neighbours rarely share a texture (no banding). Blocks
 * are batched into one InstancedMesh per (geometry, tile-set) pair.
 *
 * Note: this renders full columns down to Y=0 for a clear correctness check.
 * The visible-shell / buried-column skip lands with chunk streaming (3.3),
 * where neighbour sampling across chunk borders is set up.
 * ============================================================================
 */

import * as THREE from "three";
import { cyrb128 } from "../seed.js";

// GLTFLoader strips '.' from names, so runtime tile names are dot-less.
const TILE_BODY = "jyt_flat_33";
const TILE_CAP = { 1: "jyt_flat_13", 2: "jyt_flat_23" };
const SETS = 4;

/**
 * Pick a tile-set index (0-3) deterministically for a block.
 * @param {string} seed World seed.
 * @param {number} colX World column X.
 * @param {number} colZ World column Z.
 * @param {number} y Block base height.
 * @returns {number} Set index 0-3.
 */
function pickSet(seed, colX, colZ, y) {
	const [a] = cyrb128(`${seed}_${colX}_${colZ}_${y}`);
	return a % SETS;
}

/**
 * @typedef {object} ChunkGenContext
 * @property {Record<string, *>} worldConfig
 * @property {import("./heightField.js").HeightField} heightField
 * @property {Map<string, import("../three/tiles.js").TileEntry>} registry
 * @property {THREE.Material[]} materials Four POM materials, one per tile set.
 */

/**
 * @typedef {object} GeneratedChunk
 * @property {THREE.Group} group
 * @property {number} maxHeight Tallest column in the chunk (meters).
 * @property {number} instanceCount Total blocks placed.
 * @property {() => void} dispose
 */

/**
 * Generate a single chunk.
 * @param {number} cx Chunk X index.
 * @param {number} cz Chunk Z index.
 * @param {ChunkGenContext} ctx Generation context.
 * @returns {GeneratedChunk} The generated chunk.
 */
export function generateChunk(cx, cz, ctx) {
	const { worldConfig, heightField, registry, materials } = ctx;
	const seed = String(worldConfig.seed);
	const cs = Math.round(worldConfig.chunkSize);

	const geoms = {
		[TILE_BODY]: registry.get(TILE_BODY).geometry,
		[TILE_CAP[1]]: registry.get(TILE_CAP[1]).geometry,
		[TILE_CAP[2]]: registry.get(TILE_CAP[2]).geometry,
	};

	// Bucket placements by `${tileName}|${set}`.
	/** @type {Map<string, Array<[number, number, number]>>} */
	const buckets = new Map();
	/** @param {string} tile @param {number} set @param {number} x @param {number} y @param {number} z */
	function push(tile, set, x, y, z) {
		const key = `${tile}|${set}`;
		let arr = buckets.get(key);
		if (!arr) {
			arr = [];
			buckets.set(key, arr);
		}
		arr.push([x, y, z]);
	}

	let maxHeight = 0;
	let instanceCount = 0;

	for (let lx = 0; lx < cs; lx++) {
		for (let lz = 0; lz < cs; lz++) {
			const colX = cx * cs + lx;
			const colZ = cz * cs + lz;
			const h = heightField.columnHeight(colX, colZ);
			if (h > maxHeight) maxHeight = h;

			const wx = colX * 3;
			const wz = colZ * 3;
			const fullBlocks = Math.floor(h / 3);
			for (let b = 0; b < fullBlocks; b++) {
				const y = b * 3;
				push(TILE_BODY, pickSet(seed, colX, colZ, y), wx, y, wz);
				instanceCount++;
			}
			const rem = h % 3;
			if (rem > 0) {
				const y = fullBlocks * 3;
				push(TILE_CAP[rem], pickSet(seed, colX, colZ, y), wx, y, wz);
				instanceCount++;
			}
		}
	}

	// Build one InstancedMesh per (geometry, set).
	const group = new THREE.Group();
	const dummy = new THREE.Object3D();
	for (const [key, positions] of buckets) {
		const sep = key.indexOf("|");
		const tileName = key.slice(0, sep);
		const set = Number(key.slice(sep + 1));
		const mesh = new THREE.InstancedMesh(geoms[tileName], materials[set], positions.length);
		mesh.frustumCulled = false;
		for (let i = 0; i < positions.length; i++) {
			dummy.position.set(positions[i][0], positions[i][1], positions[i][2]);
			dummy.updateMatrix();
			mesh.setMatrixAt(i, dummy.matrix);
		}
		mesh.instanceMatrix.needsUpdate = true;
		group.add(mesh);
	}

	return {
		group,
		maxHeight,
		instanceCount,
		dispose() {
			group.traverse((o) => {
				if (/** @type {THREE.InstancedMesh} */ (o).isInstancedMesh) {
					/** @type {THREE.InstancedMesh} */ (o).dispose();
				}
			});
		},
	};
}
