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
	bridgebase: "Arena_TireBarrier_BridgeBase",
};
/** Lift tires so their base plane clears the ground. The meshes dip to y≈-0.01,
 *  so 0.01 lands exactly on the floor and still z-fights — 0.03 clears it. */
const TIRE_LIFT = 0.03;

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
	const add = (name, x, y, z, rotY, scale = 1) => {
		if (!registry.has(name)) return;
		dummy.position.set(x, y, z);
		dummy.rotation.set(0, rotY, 0);
		dummy.scale.set(scale, scale, scale);
		dummy.updateMatrix();
		if (!perPart.has(name)) perPart.set(name, []);
		perPart.get(name).push(dummy.matrix.clone());
	};

	for (const c of model.containers) {
		const t = dominoTransform(c.cells, c.orient, (c.story - 1) * 4); // story 1→Y0, 2→Y4, 3→Y8
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

	// Stadium lights ring the arena facing in (scaled per gen settings).
	for (const l of model.lights || []) {
		add("StadiumLights", l.pos[0], l.pos[1], l.pos[2], l.rotY, l.scale ?? 1);
	}

	// Charge grids: each part was baked to its own pivot in world orientation, so every
	// piece places with a plain translate + rotateY (arm rotation & extension slide both
	// reduce to a rigid transform once solved). Grid panel + 2 kitty-corner attach points,
	// and per support either a pillar or a container mount, plus its arm + sliding extension.
	for (const cg of model.chargeGrids || []) {
		add("ChargeGrid", cg.grid.pos[0], cg.grid.pos[1], cg.grid.pos[2], cg.grid.rotY);
		for (const a of cg.attaches) add("GridAttachPoint", a.pos[0], a.pos[1], a.pos[2], a.rotY);
		for (const s of cg.supports) {
			if (s.kind === "pillar") add("ChargeGridPillar", s.pillar.pos[0], s.pillar.pos[1], s.pillar.pos[2], s.pillar.rotY);
			else add("ChargeGridContainerMount", s.mount.pos[0], s.mount.pos[1], s.mount.pos[2], s.mount.rotY);
			add("ChargeGridArm", s.armPos[0], s.armPos[1], s.armPos[2], s.armYaw);
			add("ChargeGridArmExtension", s.extPos[0], s.extPos[1], s.extPos[2], s.extYaw);
		}
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

	// Tents — instanced with a per-tent random top color (setColorAt on the TentTop
	// sub-mesh only; instanceColor multiplies the material color in MeshStandardMaterial).
	const tents = model.tents || [];
	if (tents.length && registry.has("Tent")) {
		const mats = tents.map((t) => { dummy.position.set(t.pos[0], t.pos[1], t.pos[2]); dummy.rotation.set(0, t.rotY, 0); dummy.scale.set(1, 1, 1); dummy.updateMatrix(); return dummy.matrix.clone(); });
		const col = new THREE.Color();
		registry.get("Tent").forEach((entry, si) => {
			const inst = new THREE.InstancedMesh(entry.geometry, entry.material, mats.length);
			inst.name = `Tent#${si}`;
			mats.forEach((m, i) => inst.setMatrixAt(i, m));
			inst.instanceMatrix.needsUpdate = true;
			inst.frustumCulled = false;
			if (entry.material.name === "TentTop") {
				tents.forEach((t, i) => inst.setColorAt(i, col.setRGB(t.color[0], t.color[1], t.color[2])));
				if (inst.instanceColor) inst.instanceColor.needsUpdate = true;
			}
			group.add(inst);
		});
	}

	return group;
}
