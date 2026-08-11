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

	// R1 — unified ground floor: all open-ground cells (ramps as obstacles, bridges
	// count as ground) form ONE component. No isolated pockets / fall-in holes.
	{
		const og = (x, z) => isInbounds(x, z, dims) && !pokeSet.has(key(x, z)) && !l2.has(key(x, z)) && !rampSet.has(key(x, z)) && !(l3.has(key(x, z)) && !bridges.has(key(x, z)));
		let total = 0, start = null;
		for (let x = 0; x < dims.Wc; x++) for (let z = 0; z < dims.Dc; z++) if (og(x, z)) { total++; if (!start) start = [x, z]; }
		if (start) {
			const sn = new Set([key(start[0], start[1])]); const st = [start];
			while (st.length) { const [x, z] = st.pop(); for (const [dx, dz] of DIRS) { const nx = x + dx, nz = z + dz, nk = key(nx, nz); if (!sn.has(nk) && og(nx, nz)) { sn.add(nk); st.push([nx, nz]); } } }
			if (sn.size !== total) fail(`${seed}: ground floor not unified (${total - sn.size} isolated)`);
		}
	}

	// R2 — minimum platform size: no L2 island < 3, no non-bridge L3 island < 3 (bridges exempt).
	{
		const comps = (S, exclude) => {
			const out = []; const sn = new Set();
			for (const k of S) { if (sn.has(k) || (exclude && exclude.has(k))) continue; let n = 0; const st = [k]; sn.add(k); while (st.length) { const c = st.pop(); n++; const [x, z] = c.split(",").map(Number); for (const [dx, dz] of DIRS) { const nk = key(x + dx, z + dz); if (S.has(nk) && !sn.has(nk) && !(exclude && exclude.has(nk))) { sn.add(nk); st.push(nk); } } } out.push(n); }
			return out;
		};
		if (comps(l2).some((n) => n < 3)) fail(`${seed}: L2 island < 3 cells`);
		if (comps(l3, bridges).some((n) => n < 3)) fail(`${seed}: non-bridge L3 island < 3 cells`);
	}

	// No 1x1 dead-ends anywhere. Ramps are DIRECTIONAL: a 1→2 ramp is only drivable
	// from its low end, so it walls its sides/high end (edge-aware). Solid L3 blocks
	// the ground it stands on; a bridge is open below.
	const ramp12dirT = new Map(m.ramps.filter((r) => r.from === 0).map((r) => [key(r.cx, r.cz), r.dir]));
	const edgeBlockedT = (gx, gz, dx, dz) => {
		const nx = gx + dx, nz = gz + dz, nk = key(nx, nz);
		if (!isInbounds(nx, nz, dims) || pokeSet.has(nk) || l2.has(nk) || (l3.has(nk) && !bridges.has(nk))) return true;
		const rd = ramp12dirT.get(nk);
		if (rd) { const [ux, uz] = DIR_VEC[rd]; return !(dx === ux && dz === uz); }
		return false;
	};
	const openGround = (x, z) => isL1(x, z);
	for (let x = 0; x < dims.Wc && failures < 50; x++) for (let z = 0; z < dims.Dc; z++) {
		if (!openGround(x, z)) continue;
		let b = 0; for (const [dx, dz] of DIRS) if (edgeBlockedT(x, z, dx, dz)) b++;
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

	// Barriers (inner-ring railing): a rail sits ONLY on a SINGLE-STORY ring top, on an edge
	// facing the in-bounds interior (field, platform, OR poke). Never on a two-story ring
	// cell, never inside the arena (L3/poke/ground cells), never facing out of bounds.
	{
		const ringGround = new Set(); // story-1 ring container cells
		const story2 = new Set();     // cells carrying a second story
		for (const c of m.containers) {
			if (c.story === 1 && c.ring) for (const [x, z] of c.cells) ringGround.add(key(x, z));
			if (c.story === 2) for (const [x, z] of c.cells) story2.add(key(x, z));
		}
		const ring1 = (kk) => ringGround.has(kk) && !story2.has(kk); // single-story ring top
		for (const bar of m.barriers) {
			const k = key(bar.cx, bar.cz);
			const [dx, dz] = DIR_VEC[bar.dir];
			if (!ring1(k)) { fail(`${seed}: barrier not on a single-story ring cell`); continue; }
			if (!isInbounds(bar.cx + dx, bar.cz + dz, dims)) fail(`${seed}: ring rail not facing the interior`);
		}
	}

	// --- Tire barriers (Phase 7) ---
	{
		const DVv = { N: [0, -1], E: [1, 0], S: [0, 1], W: [-1, 0] };
		const CORN = { NE: ["N", "E"], SE: ["S", "E"], SW: ["S", "W"], NW: ["N", "W"] };
		const CDIAG = { NE: [1, -1], SE: [1, 1], SW: [-1, 1], NW: [-1, -1] };
		const solidMask = new Set();
		for (const c of m.containers) if (c.story === 1 && !c.bridge) for (const [x, z] of c.cells) solidMask.add(key(x, z));
		for (const k of m.level2) solidMask.add(k);
		const bridgeCellsT = new Set(m.bridges);
		const isOpenT = (x, z) => isInbounds(x, z, dims) && !solidMask.has(key(x, z)) && !rampSet.has(key(x, z));
		const isSolidCellT = (x, z) => !isInbounds(x, z, dims) || solidMask.has(key(x, z)); // cell-level (diagonals)
		// Edge-aware solidity: a 1→2 ramp is only open from its low end (sides/high = wall).
		const edgeSolidT = (x, z, dx, dz) => {
			const nx = x + dx, nz = z + dz, nk = key(nx, nz);
			if (!isInbounds(nx, nz, dims) || solidMask.has(nk)) return true;
			const rd = ramp12dirT.get(nk);
			if (rd) { const [ux, uz] = DIR_VEC[rd]; return !(dx === ux && dz === uz); }
			return false;
		};

		// Dead-end invariant (edge-aware): no open-ground cell drivable-walled on ≥3 sides.
		for (let x = 0; x < dims.Wc && failures < 60; x++) for (let z = 0; z < dims.Dc; z++) {
			if (!isOpenT(x, z)) continue;
			let s = 0; for (const d in DVv) { const [dx, dz] = DVv[d]; if (edgeSolidT(x, z, dx, dz)) s++; }
			if (s >= 3) { fail(`${seed}: tire dead-end (${s} walls) at ${x},${z}`); break; }
		}

		// Expected bridge-base edges (bridge short-end drop-offs abutting non-solid ground).
		// Bridge cells are excluded from isOpenT, so gate the cell on in-bounds instead.
		const VDIR = { "0,-1": "N", "1,0": "E", "0,1": "S", "-1,0": "W" };
		const bridgeEnds = new Set();
		for (const c of m.containers) {
			if (!c.bridge) continue;
			const [[ax, az], [bx, bz]] = c.cells;
			const abx = bx - ax, abz = bz - az;
			for (const [cx, cz, dx, dz] of [[ax, az, -abx, -abz], [bx, bz, abx, abz]]) {
				const dir = VDIR[`${dx},${dz}`];
				if (dir && isInbounds(cx, cz, dims) && !isSolidCellT(cx + dx, cz + dz)) bridgeEnds.add(`${cx},${cz}:${dir}`);
			}
		}

		// Per-cell: gather tiles, validate each rule. Bridgebase tiles live ON bridge
		// cells (not open-ground) and are validated separately against bridgeEnds.
		/** @type {Map<string,{straight:Set<string>,concave:Set<string>,convex:Set<string>}>} */
		const byCell = new Map();
		for (const t of m.tires) {
			if (t.kind === "bridgebase") {
				if (!bridgeCellsT.has(key(t.cx, t.cz))) fail(`${seed}: bridgebase not on a bridge cell @${t.cx},${t.cz}`);
				else if (!bridgeEnds.has(`${t.cx},${t.cz}:${t.code}`)) fail(`${seed}: bridgebase ${t.code} not at a bridge drop-off @${t.cx},${t.cz}`);
				continue;
			}
			if (!isOpenT(t.cx, t.cz)) { fail(`${seed}: tire on non-open cell ${t.cx},${t.cz}`); continue; }
			const ck = key(t.cx, t.cz);
			if (!byCell.has(ck)) byCell.set(ck, { straight: new Set(), concave: new Set(), convex: new Set() });
			byCell.get(ck)[t.kind].add(t.code);
		}
		for (const [ck, g] of byCell) {
			const [x, z] = ck.split(",").map(Number);
			const cov = new Set();
			// concave (nook) → OuterCorner mesh: both edges solid (edge-aware); covers them.
			for (const cn of g.concave) { const [e1, e2] = CORN[cn]; if (!edgeSolidT(x, z, ...DVv[e1]) || !edgeSolidT(x, z, ...DVv[e2])) fail(`${seed}: concave ${cn} without 2 solid edges @${ck}`); cov.add(e1); cov.add(e2); }
			for (const d of g.straight) {
				if (!edgeSolidT(x, z, ...DVv[d])) fail(`${seed}: straight ${d} on open edge @${ck}`);
				if (cov.has(d)) fail(`${seed}: straight ${d} not suppressed by concave corner @${ck}`);
			}
			// convex (poke) → InnerCorner mesh: diagonal solid, both orthogonals open.
			for (const cn of g.convex) { const [e1, e2] = CORN[cn]; const [dx, dz] = CDIAG[cn]; if (edgeSolidT(x, z, ...DVv[e1]) || edgeSolidT(x, z, ...DVv[e2]) || !isSolidCellT(x + dx, z + dz)) fail(`${seed}: bad convex ${cn} @${ck}`); }
		}

		// Completeness: every solid edge of an open cell is covered by a straight or concave corner.
		for (let x = 0; x < dims.Wc && failures < 60; x++) for (let z = 0; z < dims.Dc; z++) {
			if (!isOpenT(x, z)) continue;
			const g = byCell.get(key(x, z));
			for (const d in DVv) {
				if (!edgeSolidT(x, z, ...DVv[d])) continue;
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
