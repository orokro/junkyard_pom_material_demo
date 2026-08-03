/**
 * ============================================================================
 * arena/three/build.js
 * ----------------------------------------------------------------------------
 * Turns an ArenaModel (pure data) into a THREE.Group of InstancedMeshes using
 * the parts registry from library.js (name → array of sub-mesh {geometry,material}).
 *
 * Placement is uniform: translate the part's pivot to a target world point and
 * rotate about Y. Containers/bridges are dominoes → pivot to the midpoint of
 * their two cell centers; H (long east-west) = rot 0, V = rot 90°. Chairs use
 * their given world pos/rotation. Multi-material parts emit one InstancedMesh
 * per sub-mesh, all sharing the same set of instance transforms.
 * ============================================================================
 */

import * as THREE from "three";
import { CELL, cellCenter } from "../gen/grid.js";

/** Ramp up-direction (N=-Z default) → Y rotation. */
const RAMP_ROT = { N: 0, E: -Math.PI / 2, S: Math.PI, W: Math.PI / 2 };

/**
 * Metal-barrier facing → Y rotation. The part authors its wall on the NORTH
 * (−Z) edge of its cell (pivot = cell center); this rotation swings that wall to
 * the requested edge. Same mapping as the ramp up-direction, by construction.
 */
const MB_ROT = { N: 0, E: -Math.PI / 2, S: Math.PI, W: Math.PI / 2 };

/**
 * Tire kind → part name. NOTE the corner mapping: a CONCAVE nook (two walls
 * meeting) is rounded by the OuterCorner mesh ("outer" = the curve is completed
 * from outside the tile); a CONVEX poking corner is wrapped by the InnerCorner
 * mesh ("inner" = concave curve inside the tile).
 */
const TIRE_PART = {
	straight: "Arena_TireBarrier_Straight_East",
	concave: "Arena_TireBarrier_OuterCorner_NorthEast",
	convex: "Arena_TireBarrier_InnerCorner_NorthEast",
};
/** Lift tires 1 cm so their base plane doesn't z-fight the ground/floor. */
const TIRE_LIFT = 0.01;

/**
 * @param {[[number,number],[number,number]]} cells @param {"H"|"V"} orient @param {number} baseY
 * @returns {{x:number,y:number,z:number,rotY:number}}
 */
function dominoTransform(cells, orient, baseY) {
	const [[ax, az], [bx, bz]] = cells;
	const x = (ax * CELL + CELL / 2 + (bx * CELL + CELL / 2)) / 2;
	const z = (az * CELL + CELL / 2 + (bz * CELL + CELL / 2)) / 2;
	return { x, y: baseY, z, rotY: orient === "H" ? 0 : Math.PI / 2 };
}

/**
 * @param {import("../gen/arena.js").ArenaModel} model
 * @param {Map<string, import("./library.js").PartEntry[]>} registry
 * @returns {THREE.Group}
 */
export function buildArena(model, registry) {
	const group = new THREE.Group();
	group.name = "ArenaBuild";

	// Collect instance transforms per part name.
	/** @type {Map<string, THREE.Matrix4[]>} */
	const perPart = new Map();
	const dummy = new THREE.Object3D();
	const add = (name, x, y, z, rotY) => {
		if (!registry.has(name)) return;
		dummy.position.set(x, y, z);
		dummy.rotation.set(0, rotY, 0);
		dummy.scale.set(1, 1, 1);
		dummy.updateMatrix();
		if (!perPart.has(name)) perPart.set(name, []);
		perPart.get(name).push(dummy.matrix.clone());
	};

	for (const c of model.containers) {
		const t = dominoTransform(c.cells, c.orient, c.story === 2 ? 4 : 0);
		// Bridges share the container footprint/pivot but use the open-underside mesh.
		if (c.bridge) add("Arena_Bridge", t.x, t.y, t.z, t.rotY);
		else add(`Arena_ShippingContainer_${c.color}`, t.x, t.y, t.z, t.rotY);
	}
	for (const ch of model.chairs) {
		add(`Arena_${ch.chairType}`, ch.pos[0], ch.pos[1], ch.pos[2], ch.rotY);
	}

	// Level-2 half-platforms.
	for (const k of model.level2 || []) {
		const [cx, cz] = k.split(",").map(Number);
		const [x, z] = cellCenter(cx, cz);
		add("Arena_HalfPlatform", x, 0, z, 0);
	}

	// Ramps. from=0 → 1→2 ramp sits on the ground (Y=0); from=2 → 2→3 ramp sits
	// on a half-platform (Y=2). Rotation aims the high side along the up direction.
	for (const r of model.ramps || []) {
		const [x, z] = cellCenter(r.cx, r.cz);
		add("Arena_Ramp", x, r.from === 2 ? 2 : 0, z, RAMP_ROT[r.dir] ?? 0);
	}

	// Metal barriers guard Y4 surface edges (L3 tops / poke tops) that face OOB.
	for (const b of model.barriers || []) {
		const [x, z] = cellCenter(b.cx, b.cz);
		add("Arena_Metal_Barrier", x, 4, z, MB_ROT[b.dir] ?? 0);
	}

	// Tire barriers (ground-level autotiled bumpers), lifted 1 cm off the floor.
	for (const t of model.tires || []) {
		const [x, z] = cellCenter(t.cx, t.cz);
		add(TIRE_PART[t.kind], x, TIRE_LIFT, z, t.rotY);
	}

	// Materialize: one InstancedMesh per (part, sub-mesh), sharing the transforms.
	for (const [name, matrices] of perPart.entries()) {
		const entries = registry.get(name);
		entries.forEach((entry, si) => {
			const inst = new THREE.InstancedMesh(entry.geometry, entry.material, matrices.length);
			inst.name = `${name}#${si}`;
			matrices.forEach((m, i) => inst.setMatrixAt(i, m));
			inst.instanceMatrix.needsUpdate = true;
			inst.frustumCulled = false;
			group.add(inst);
		});
	}

	return group;
}
