/** Headless validation harness for arena generation (phase 5 + phase 6 steps 1 & 2a). */
import { generateArena } from "./src/arena/gen/arena.js";
import { ringBandCells, key, isInbounds, cellCenter } from "./src/arena/gen/grid.js";
import { DIR_VEC } from "./src/arena/gen/islands.js";
import { makeSurfaceSampler } from "./src/arena/gen/surface.js";

const params = { arenaSizeMeters: 60, aspectMin: 0.5, aspectMax: 2.0, minInboundsCells: 5, maxInwardPokes: 6 };
const DIRS = [[1, 0], [-1, 0], [0, 1], [0, -1]];
let failures = 0;
const fail = (m) => { console.log("  ✗", m); failures++; };

const seeds = [];
for (let i = 0; i < 120; i++) seeds.push("s_" + i.toString(36) + "_arena");

let noL2 = 0, noL3 = 0, totalCov2 = 0, totalCov3 = 0, totalRamps = 0, totalRamps23 = 0, totalBarriers = 0, totalBridges = 0, seedsWithBridge = 0, totalTires = 0;
for (const seed of seeds) {
	const m = generateArena(seed, params);
	const dims = m.dims;
	const l2 = new Set(m.level2);
	const l3 = new Set(m.level3);
	const bridges = new Set(m.bridges);
	const rampSet = new Set(m.ramps.map((r) => key(r.cx, r.cz)));
	// Pokes = ground WALL containers that poke inward (NOT the L3 island containers).
	const pokeSet = new Set();
	for (const c of m.containers) if (c.story === 1 && !c.ring && !c.level3) for (const [x, z] of c.cells) pokeSet.add(key(x, z));

	// Ring gap-free.
	const frame = ringBandCells(dims, 2).map((c) => key(c[0], c[1]));
	const cover = new Set();
	for (const c of m.containers) if (c.story === 1 && c.ring) for (const [x, z] of c.cells) cover.add(key(x, z));
	if (frame.some((k) => !cover.has(k))) fail(`${seed}: ring gaps`);

	// L3 containers never overlap L2, pokes, or ramps.
	for (const k of m.level3) {
		if (l2.has(k)) fail(`${seed}: L3 overlaps L2 @${k}`);
		if (pokeSet.has(k)) fail(`${seed}: L3 overlaps poke @${k}`);
		if (rampSet.has(k)) fail(`${seed}: L3 overlaps ramp @${k}`);
	}
	// Every L3 domino covers exactly cells that are in level3.
	for (const c of m.containers) if (c.level3) for (const [x, z] of c.cells) if (!l3.has(key(x, z))) fail(`${seed}: L3 domino cell not in level3`);

	// --- Level 2 / Level 3 coverage stats ---
	if (m.level2.length === 0) noL2++;
	if (m.level3.length === 0) noL3++;
	totalCov2 += m.level2.length / (dims.Wc * dims.Dc);
	totalCov3 += m.level3.length / (dims.Wc * dims.Dc);
	totalRamps += m.ramps.filter((r) => r.from === 0).length;
	totalRamps23 += m.ramps.filter((r) => r.from === 2).length;
	totalBarriers += m.barriers.length;
	totalBridges += m.containers.filter((c) => c.bridge).length;
	if (m.bridges.length) seedsWithBridge++;

	// Ramp runs valid (both 1→2 and 2→3).
	for (const r of m.ramps) {
		const [dx, dz] = DIR_VEC[r.dir];
		const landing = key(r.cx + dx, r.cz + dz);
		const lead = key(r.cx - dx, r.cz - dz);
		const rampK = key(r.cx, r.cz);
		if (!isInbounds(r.cx - dx, r.cz - dz, dims) || !isInbounds(r.cx + dx, r.cz + dz, dims)) fail(`${seed}: ramp run OOB`);
		if (r.from === 0) {
			if (!l2.has(landing)) fail(`${seed}: 1→2 ramp landing not L2`);
			if (l2.has(lead) || l3.has(lead)) fail(`${seed}: 1→2 ramp lead raised (should stay L1)`);
			if (l2.has(rampK) || l3.has(rampK)) fail(`${seed}: 1→2 ramp cell raised`);
			if (pokeSet.has(rampK) || pokeSet.has(landing) || pokeSet.has(lead)) fail(`${seed}: 1→2 ramp overlaps poke`);
		} else {
			if (!l3.has(landing)) fail(`${seed}: 2→3 ramp landing not L3`);
			if (!l2.has(lead)) fail(`${seed}: 2→3 ramp lead not L2`);
			if (!l2.has(rampK)) fail(`${seed}: 2→3 ramp cell not on a half-platform`);
			if (l3.has(rampK)) fail(`${seed}: 2→3 ramp cell also L3`);
		}
	}

	// Connectivity: all drivable surfaces one component. A bridge cell is BOTH an
	// open ground node (drive under) AND an L3 top node (drive over) — two nodes.
	const isL1 = (x, z) => isInbounds(x, z, dims) && !pokeSet.has(key(x, z)) && !l2.has(key(x, z)) && !rampSet.has(key(x, z)) && !(l3.has(key(x, z)) && !bridges.has(key(x, z)));
	{
		const edges = new Map();
		const addE = (a, b) => { (edges.get(a) || edges.set(a, []).get(a)).push(b); };
		for (const r of m.ramps) {
			const [dx, dz] = DIR_VEC[r.dir];
			const lo = r.from === 0 ? "1" : "2", hi = r.to === 2 ? "2" : "3";
			const lead = `${lo}:${r.cx - dx},${r.cz - dz}`, land = `${hi}:${r.cx + dx},${r.cz + dz}`;
			addE(lead, land); addE(land, lead);
		}
		let total = 0, start = null;
		for (let x = 0; x < dims.Wc; x++) for (let z = 0; z < dims.Dc; z++) {
			if (isL1(x, z)) { total++; start = start || `1:${x},${z}`; }
			if (l2.has(key(x, z))) { total++; start = start || `2:${x},${z}`; }
			if (l3.has(key(x, z))) { total++; start = start || `3:${x},${z}`; }
		}
		if (start) {
			const seen = new Set([start]);
			const st = [start];
			while (st.length) {
				const cur = st.pop();
				const lvl = cur[0];
				const [x, z] = cur.slice(2).split(",").map(Number);
				for (const [dx, dz] of DIRS) {
					const nx = x + dx, nz = z + dz;
					let nk = null;
					if (lvl === "1" && isL1(nx, nz)) nk = `1:${nx},${nz}`;
					else if (lvl === "2" && l2.has(key(nx, nz))) nk = `2:${nx},${nz}`;
					else if (lvl === "3" && l3.has(key(nx, nz))) nk = `3:${nx},${nz}`;
					if (nk && !seen.has(nk)) { seen.add(nk); st.push(nk); }
				}
				const re = edges.get(cur);
				if (re) for (const nk of re) if (!seen.has(nk)) { seen.add(nk); st.push(nk); }
			}
			if (seen.size !== total) fail(`${seed}: disconnected drivable (${total - seen.size} trapped)`);
		}
	}

	// Every L2 island (component) contains a 1→2 ramp landing.
	const landings2 = new Set(m.ramps.filter((r) => r.from === 0).map((r) => { const [dx, dz] = DIR_VEC[r.dir]; return key(r.cx + dx, r.cz + dz); }));
	{
		const seen = new Set();
		for (const k of m.level2) {
			if (seen.has(k)) continue;
			const comp = []; const st = [k]; seen.add(k);
			while (st.length) { const cur = st.pop(); comp.push(cur); const [x, z] = cur.split(",").map(Number); for (const [dx, dz] of DIRS) { const nk = key(x + dx, z + dz); if (l2.has(nk) && !seen.has(nk)) { seen.add(nk); st.push(nk); } } }
			if (!comp.some((c) => landings2.has(c))) fail(`${seed}: L2 island with no ramp`);
		}
	}

	// Every L3 island (component) contains a 2→3 ramp landing.
	const landings3 = new Set(m.ramps.filter((r) => r.from === 2).map((r) => { const [dx, dz] = DIR_VEC[r.dir]; return key(r.cx + dx, r.cz + dz); }));
	{
		const seen = new Set();
		for (const k of m.level3) {
			if (seen.has(k)) continue;
			const comp = []; const st = [k]; seen.add(k);
			while (st.length) { const cur = st.pop(); comp.push(cur); const [x, z] = cur.split(",").map(Number); for (const [dx, dz] of DIRS) { const nk = key(x + dx, z + dz); if (l3.has(nk) && !seen.has(nk)) { seen.add(nk); st.push(nk); } } }
			if (!comp.some((c) => landings3.has(c))) fail(`${seed}: L3 island with no ramp`);
		}
	}

	// No 1x1 dead-ends anywhere (ramps count as OPEN; solid L3 blocks the ground it
	// stands on, but a bridge is open below → not blocking).
	const blocking = (x, z) => !isInbounds(x, z, dims) || pokeSet.has(key(x, z)) || l2.has(key(x, z)) || (l3.has(key(x, z)) && !bridges.has(key(x, z)));
	const openGround = (x, z) => isL1(x, z);
	for (let x = 0; x < dims.Wc && failures < 50; x++) for (let z = 0; z < dims.Dc; z++) {
		if (!openGround(x, z)) continue;
		let b = 0; for (const [dx, dz] of DIRS) if (blocking(x + dx, z + dz)) b++;
		if (b >= 3) { fail(`${seed}: island dead-end at ${x},${z}`); break; }
	}

	// Bridges: every bridge cell is an L3 top, and each bridge domino has a real
	// through-lane beneath it (drivable ground on both long sides of some cell).
	for (const k of m.bridges) if (!l3.has(k)) fail(`${seed}: bridge cell not L3 @${k}`);
	{
		const CROSS = { H: [[0, -1], [0, 1]], V: [[-1, 0], [1, 0]] };
		const og = (x, z) => isL1(x, z); // drivable ground (bridge undersides included)
		for (const c of m.containers.filter((c) => c.bridge)) {
			const [cd0, cd1] = CROSS[c.orient];
			const lane = c.cells.some(([x, z]) => og(x + cd0[0], z + cd0[1]) && og(x + cd1[0], z + cd1[1]));
			if (!lane) fail(`${seed}: bridge with no through-lane`);
		}
	}

	// Barriers: each guards a Y4-surface cell (L3 or poke) on an edge that faces OOB.
	const surfaces = new Set([...m.level3, ...pokeSet]);
	for (const bar of m.barriers) {
		const k = key(bar.cx, bar.cz);
		if (!surfaces.has(k)) fail(`${seed}: barrier not on a Y4 surface cell`);
		const [dx, dz] = DIR_VEC[bar.dir];
		if (isInbounds(bar.cx + dx, bar.cz + dz, dims)) fail(`${seed}: barrier not facing OOB`);
	}

	// --- Tire barriers (Phase 7) ---
	{
		const DVv = { N: [0, -1], E: [1, 0], S: [0, 1], W: [-1, 0] };
		const CORN = { NE: ["N", "E"], SE: ["S", "E"], SW: ["S", "W"], NW: ["N", "W"] };
		const CDIAG = { NE: [1, -1], SE: [1, 1], SW: [-1, 1], NW: [-1, -1] };
		const solidMask = new Set();
		for (const c of m.containers) if (c.story === 1 && !c.bridge) for (const [x, z] of c.cells) solidMask.add(key(x, z));
		for (const k of m.level2) solidMask.add(k);
		const isSolidT = (x, z) => !isInbounds(x, z, dims) || solidMask.has(key(x, z));
		const isOpenT = (x, z) => isInbounds(x, z, dims) && !solidMask.has(key(x, z)) && !rampSet.has(key(x, z));

		// Dead-end invariant: no open-ground cell walled on ≥3 sides.
		for (let x = 0; x < dims.Wc && failures < 60; x++) for (let z = 0; z < dims.Dc; z++) {
			if (!isOpenT(x, z)) continue;
			let s = 0; for (const d in DVv) { const [dx, dz] = DVv[d]; if (isSolidT(x + dx, z + dz)) s++; }
			if (s >= 3) { fail(`${seed}: tire dead-end (${s} walls) at ${x},${z}`); break; }
		}

		// Expected bridge-pillar straight edges (short-ends abutting a non-solid cell).
		const VDIR = { "0,-1": "N", "1,0": "E", "0,1": "S", "-1,0": "W" };
		const pillars = new Set();
		for (const c of m.containers) {
			if (!c.bridge) continue;
			const [[ax, az], [bx, bz]] = c.cells;
			const abx = bx - ax, abz = bz - az;
			for (const [cx, cz, dx, dz] of [[ax, az, -abx, -abz], [bx, bz, abx, abz]]) {
				const dir = VDIR[`${dx},${dz}`];
				if (dir && isOpenT(cx, cz) && !isSolidT(cx + dx, cz + dz)) pillars.add(`${cx},${cz}:${dir}`);
			}
		}

		// Per-cell: gather tiles, validate each rule.
		/** @type {Map<string,{straight:Set<string>,concave:Set<string>,convex:Set<string>}>} */
		const byCell = new Map();
		for (const t of m.tires) {
			if (!isOpenT(t.cx, t.cz)) { fail(`${seed}: tire on non-open cell ${t.cx},${t.cz}`); continue; }
			const ck = key(t.cx, t.cz);
			if (!byCell.has(ck)) byCell.set(ck, { straight: new Set(), concave: new Set(), convex: new Set() });
			byCell.get(ck)[t.kind].add(t.code);
		}
		for (const [ck, g] of byCell) {
			const [x, z] = ck.split(",").map(Number);
			const cov = new Set();
			// concave (nook) → OuterCorner mesh: both edges must be solid; covers them.
			for (const cn of g.concave) { const [e1, e2] = CORN[cn]; if (!isSolidT(x + DVv[e1][0], z + DVv[e1][1]) || !isSolidT(x + DVv[e2][0], z + DVv[e2][1])) fail(`${seed}: concave ${cn} without 2 solid edges @${ck}`); cov.add(e1); cov.add(e2); }
			for (const d of g.straight) {
				const solidEdge = isSolidT(x + DVv[d][0], z + DVv[d][1]);
				if (!solidEdge && !pillars.has(`${ck}:${d}`)) fail(`${seed}: straight ${d} on open edge (not pillar) @${ck}`);
				if (cov.has(d)) fail(`${seed}: straight ${d} not suppressed by concave corner @${ck}`);
			}
			// convex (poke) → InnerCorner mesh: diagonal solid, both orthogonals open.
			for (const cn of g.convex) { const [e1, e2] = CORN[cn]; const [dx, dz] = CDIAG[cn]; if (isSolidT(x + DVv[e1][0], z + DVv[e1][1]) || isSolidT(x + DVv[e2][0], z + DVv[e2][1]) || !isSolidT(x + dx, z + dz)) fail(`${seed}: bad convex ${cn} @${ck}`); }
		}

		// Completeness: every solid edge of an open cell is covered by a straight or concave corner.
		for (let x = 0; x < dims.Wc && failures < 60; x++) for (let z = 0; z < dims.Dc; z++) {
			if (!isOpenT(x, z)) continue;
			const g = byCell.get(key(x, z));
			for (const d in DVv) {
				if (!isSolidT(x + DVv[d][0], z + DVv[d][1])) continue;
				const covered = g && (g.straight.has(d) || [...g.concave].some((cn) => CORN[cn].includes(d)));
				if (!covered) { fail(`${seed}: uncovered solid edge ${d} @${x},${z}`); break; }
			}
		}
		totalTires += m.tires.length;
	}

	// Surface sampler: flat L2 → 2, L3 → 4, a known ground cell → 0. Skip cells that
	// carry a ramp (a 2→3 ramp sits on an L2 half-platform, so it reads the incline).
	const samp = makeSurfaceSampler(m);
	for (const kk of m.level2) { if (rampSet.has(kk)) continue; const [cx, cz] = kk.split(",").map(Number); const [wx, wz] = cellCenter(cx, cz); if (samp(wx, wz) !== 2) { fail(`${seed}: sampler L2 != 2`); break; } }
	for (const kk of m.level3) { if (rampSet.has(kk)) continue; const [cx, cz] = kk.split(",").map(Number); const [wx, wz] = cellCenter(cx, cz); if (samp(wx, wz) !== 4) { fail(`${seed}: sampler L3 != 4`); break; } }
}

console.log(`\nSeeds: ${seeds.length} | no-L2: ${noL2} | no-L3: ${noL3} | seeds w/ bridge: ${seedsWithBridge}`);
console.log(`avg L2 cov: ${(100 * totalCov2 / seeds.length).toFixed(1)}% | avg L3 cov: ${(100 * totalCov3 / seeds.length).toFixed(1)}% | avg 1→2 ramps: ${(totalRamps / seeds.length).toFixed(1)} | avg 2→3 ramps: ${(totalRamps23 / seeds.length).toFixed(1)} | avg bridges: ${(totalBridges / seeds.length).toFixed(1)} | avg barriers: ${(totalBarriers / seeds.length).toFixed(1)} | avg tires: ${(totalTires / seeds.length).toFixed(1)}`);
console.log(failures === 0 ? "ALL CHECKS PASSED" : `${failures} FAILURE(S)`);
process.exit(failures === 0 ? 0 : 1);
