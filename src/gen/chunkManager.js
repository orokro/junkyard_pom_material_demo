/**
 * ============================================================================
 * gen/chunkManager.js
 * ----------------------------------------------------------------------------
 * Streams chunks around the camera. Keeps an active set keyed by `${cx}_${cz}`,
 * generates chunks that enter render distance (nearest-first, budgeted per
 * frame so generation never hitches), and disposes chunks that leave.
 *
 * The map is infinite in +X and ±Z but empty west of the spawn edge, so chunks
 * with cx < 0 are never generated. Chunk geometry/materials are shared via the
 * registry, so disposing a chunk only frees its InstancedMesh buffers.
 * ============================================================================
 */

import { generateChunk } from "./chunk.js";

/**
 * @typedef {object} ChunkManager
 * @property {(camPos: {x: number, z: number}, budget?: number) => void} update
 * @property {() => import("./chunk.js").GeneratedChunk[]} getChunks
 * @property {() => { active: number, pending: number }} stats
 * @property {() => void} dispose
 */

/**
 * Create a chunk-streaming manager.
 * @param {import("three").Scene} scene Scene to add/remove chunk groups.
 * @param {{worldConfig: Record<string, *>, heightField: *, registry: Map<string, *>, materials: *[]}} ctx Generation context.
 * @param {{ renderDistance?: number, budget?: number, onChunkCreated?: (chunk: *) => void }} [opts]
 * @returns {ChunkManager}
 */
export function createChunkManager(scene, ctx, opts = {}) {
	const cs = Math.round(ctx.worldConfig.chunkSize);
	const chunkWorld = cs * 3;
	const R = Math.max(1, Math.round(opts.renderDistance ?? 6));
	const defaultBudget = opts.budget ?? 6; // hard cap on chunks per frame
	const timeBudgetMs = opts.timeBudgetMs ?? 4; // soft per-frame time slice
	const nowMs = () => (typeof performance !== "undefined" ? performance.now() : Date.now());

	/** @type {Map<string, { chunk: *, cx: number, cz: number }>} */
	const active = new Map();
	let pendingCount = 0;

	const key = (cx, cz) => `${cx}_${cz}`;

	/**
	 * Desired chunk coords for a camera position (circular, +X only).
	 * @param {number} camX @param {number} camZ
	 * @returns {Map<string, {cx: number, cz: number}>}
	 */
	function desiredSet(camX, camZ) {
		const ccx = Math.floor(camX / chunkWorld);
		const ccz = Math.floor(camZ / chunkWorld);
		/** @type {Map<string, {cx: number, cz: number}>} */
		const set = new Map();
		for (let dx = -R; dx <= R; dx++) {
			for (let dz = -R; dz <= R; dz++) {
				if (dx * dx + dz * dz > R * R) continue;
				const cx = ccx + dx;
				const cz = ccz + dz;
				if (cx < 0) continue; // nothing west of the spawn edge
				set.set(key(cx, cz), { cx, cz });
			}
		}
		return set;
	}

	/**
	 * Reconcile the active set with the camera position.
	 * @param {{x: number, z: number}} camPos
	 * @param {number} [budget] Max chunks to generate this call (Infinity to prime).
	 * @param {boolean} [timeSliced] Stop early once the per-frame time budget is spent
	 *   (always makes at least one chunk of progress). Pass false to prime fully.
	 * @returns {void}
	 */
	function update(camPos, budget = defaultBudget, timeSliced = true) {
		const set = desiredSet(camPos.x, camPos.z);

		// Dispose chunks that left range.
		for (const [k, entry] of active) {
			if (!set.has(k)) {
				scene.remove(entry.chunk.group);
				entry.chunk.dispose();
				active.delete(k);
			}
		}

		// Queue missing chunks, nearest first.
		/** @type {Array<{cx: number, cz: number, k: string, d: number}>} */
		const pending = [];
		for (const [k, { cx, cz }] of set) {
			if (active.has(k)) continue;
			const centerX = (cx * cs + cs / 2) * 3;
			const centerZ = (cz * cs + cs / 2) * 3;
			const d = (centerX - camPos.x) ** 2 + (centerZ - camPos.z) ** 2;
			pending.push({ cx, cz, k, d });
		}
		pending.sort((a, b) => a.d - b.d);
		pendingCount = pending.length;

		const start = nowMs();
		let made = 0;
		for (const p of pending) {
			if (made >= budget) break;
			// Time slice: after at least one chunk, bail if we've blown the frame
			// budget — the rest stream in over subsequent frames, keeping fps smooth.
			if (timeSliced && made >= 1 && nowMs() - start >= timeBudgetMs) break;
			const chunk = generateChunk(p.cx, p.cz, ctx);
			scene.add(chunk.group);
			active.set(p.k, { chunk, cx: p.cx, cz: p.cz });
			opts.onChunkCreated?.(chunk);
			made++;
		}
		pendingCount -= made;
	}

	return {
		update,
		getChunks() {
			return [...active.values()].map((e) => e.chunk);
		},
		/**
		 * Active chunks whose footprint is within `radiusM` of a world point.
		 * @param {number} x @param {number} z @param {number} radiusM
		 * @returns {import("./chunk.js").GeneratedChunk[]}
		 */
		getChunksNear(x, z, radiusM) {
			const reach = radiusM + chunkWorld; // pad so partially-covered chunks count
			const r2 = reach * reach;
			/** @type {import("./chunk.js").GeneratedChunk[]} */
			const out = [];
			for (const { chunk, cx, cz } of active.values()) {
				const centerX = (cx * cs + cs / 2) * 3;
				const centerZ = (cz * cs + cs / 2) * 3;
				if ((centerX - x) ** 2 + (centerZ - z) ** 2 <= r2) out.push(chunk);
			}
			return out;
		},
		stats() {
			return { active: active.size, pending: pendingCount };
		},
		dispose() {
			for (const { chunk } of active.values()) {
				scene.remove(chunk.group);
				chunk.dispose();
			}
			active.clear();
		},
	};
}
