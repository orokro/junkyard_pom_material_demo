/**
 * ============================================================================
 * arena/three/build.js
 * ----------------------------------------------------------------------------
 * Turns an ArenaModel (pure data) into a THREE.Group of InstancedMeshes using
 * the parts registry from library.js.
 *
 * Placement is uniform: translate the piece's pivot to a target world point and
 * rotate about Y. Containers/bridges are dominoes → their pivot goes to the
 * midpoint of the two cell centers; H (long east-west) = rot 0, V (long
 * north-south) = rot 90°. Chairs are placed at their given world pos/rotation.
 *
 * Phase 5 renders: ring/poke containers (both stories) + grandstand chairs.
 * ============================================================================
 */

import * as THREE from "three";
import { CELL } from "../gen/grid.js";

/**
 * Compute a container/bridge transform from its two cells + story.
 * @param {[[number,number],[number,number]]} cells
 * @param {"H"|"V"} orient
 * @param {number} baseY  0 for story 1, 4 for story 2.
 * @returns {{ x:number, y:number, z:number, rotY:number }}
 */
function dominoTransform(cells, orient, baseY) {
	const [[ax, az], [bx, bz]] = cells;
	// Midpoint of the two cell centers.
	const x = ((ax * CELL + CELL / 2) + (bx * CELL + CELL / 2)) / 2;
	const z = ((az * CELL + CELL / 2) + (bz * CELL + CELL / 2)) / 2;
	return { x, y: baseY, z, rotY: orient === "H" ? 0 : Math.PI / 2 };
}

/**
 * Build the arena scene group.
 * @param {import("../gen/arena.js").ArenaModel} model
 * @param {Map<string, import("./library.js").PartEntry>} registry
 * @returns {THREE.Group}
 */
export function buildArena(model, registry) {
	const group = new THREE.Group();
	group.name = "ArenaBuild";

	// Bucket placements by source part name → list of matrices.
	/** @type {Map<string, THREE.Matrix4[]>} */
	const buckets = new Map();
	const dummy = new THREE.Object3D();
	const push = (name, x, y, z, rotY) => {
		if (!registry.has(name)) return;
		dummy.position.set(x, y, z);
		dummy.rotation.set(0, rotY, 0);
		dummy.scale.set(1, 1, 1);
		dummy.updateMatrix();
		if (!buckets.has(name)) buckets.set(name, []);
		buckets.get(name).push(dummy.matrix.clone());
	};

	// Containers (and, later, bridges) — dominoes.
	for (const c of model.containers) {
		const t = dominoTransform(c.cells, c.orient, c.story === 2 ? 4 : 0);
		push(`Arena_ShippingContainer_${c.color}`, t.x, t.y, t.z, t.rotY);
	}

	// Chairs.
	for (const ch of model.chairs) {
		push(`Arena_${ch.chairType}`, ch.pos[0], ch.pos[1], ch.pos[2], ch.rotY);
	}

	// Materialize InstancedMeshes.
	for (const [name, mats] of buckets.entries()) {
		const entry = registry.get(name);
		const inst = new THREE.InstancedMesh(entry.geometry, entry.material, mats.length);
		inst.name = name;
		mats.forEach((m, i) => inst.setMatrixAt(i, m));
		inst.instanceMatrix.needsUpdate = true;
		inst.frustumCulled = false;
		group.add(inst);
	}

	return group;
}
