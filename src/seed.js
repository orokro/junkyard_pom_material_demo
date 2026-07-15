/**
 * ============================================================================
 * seed.js
 * ----------------------------------------------------------------------------
 * Deterministic seeding utilities.
 *
 * A single seed string drives the entire map. Everything that needs randomness
 * (noise, path routing, per-block texture pick) must derive from a PRNG created
 * here — no bare Math.random in generation, so every client reproduces the same
 * world from the same seed.
 *
 *   cyrb128     : string → 128-bit hash (4 × uint32), good avalanche.
 *   mulberry32  : uint32 → fast, decent-quality [0,1) generator.
 *   makeRng     : seed string (+ optional salt) → generator function.
 *   hashKey     : compose a deterministic sub-seed like `${seed}_${cx}_${cz}`.
 *
 * The last-used seed is persisted to localStorage so the start screen can
 * restore it between visits.
 * ============================================================================
 */

const STORAGE_KEY = "jy_pom_demo.lastSeed";

/**
 * Hash a string to four 32-bit integers (cyrb128).
 * @param {string} str Input string.
 * @returns {[number, number, number, number]} Four uint32 hash words.
 */
export function cyrb128(str) {
	let h1 = 1779033703, h2 = 3144134277, h3 = 1013904242, h4 = 2773480762;
	for (let i = 0; i < str.length; i++) {
		const k = str.charCodeAt(i);
		h1 = h2 ^ Math.imul(h1 ^ k, 597399067);
		h2 = h3 ^ Math.imul(h2 ^ k, 2869860233);
		h3 = h4 ^ Math.imul(h3 ^ k, 951274213);
		h4 = h1 ^ Math.imul(h4 ^ k, 2716044179);
	}
	h1 = Math.imul(h3 ^ (h1 >>> 18), 597399067);
	h2 = Math.imul(h4 ^ (h2 >>> 22), 2869860233);
	h3 = Math.imul(h1 ^ (h3 >>> 17), 951274213);
	h4 = Math.imul(h2 ^ (h4 >>> 19), 2716044179);
	return [
		(h1 ^ h2 ^ h3 ^ h4) >>> 0,
		(h2 ^ h1) >>> 0,
		(h3 ^ h1) >>> 0,
		(h4 ^ h1) >>> 0,
	];
}

/**
 * Mulberry32 PRNG.
 * @param {number} a uint32 seed.
 * @returns {() => number} Function yielding floats in [0, 1).
 */
export function mulberry32(a) {
	let s = a >>> 0;
	return function next() {
		s = (s + 0x6d2b79f5) >>> 0;
		let t = s;
		t = Math.imul(t ^ (t >>> 15), t | 1);
		t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
		return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
	};
}

/**
 * Build a PRNG from a seed string and optional salt.
 * @param {string} seed Base seed string.
 * @param {string} [salt] Extra namespacing (e.g. "paths", "noise").
 * @returns {() => number} PRNG in [0, 1).
 */
export function makeRng(seed, salt = "") {
	const [a] = cyrb128(`${seed}::${salt}`);
	return mulberry32(a);
}

/**
 * Compose a deterministic sub-seed key from parts.
 * @param {...(string|number)} parts Key parts (e.g. seed, cx, cz).
 * @returns {string} Joined key.
 */
export function hashKey(...parts) {
	return parts.join("_");
}

/**
 * Generate a fresh, human-friendly random seed string.
 * Uses crypto when available, falling back to Math.random (UI action only —
 * never used inside map generation).
 * @returns {string} New seed like "k7f3q9zt".
 */
export function rollSeed() {
	let n;
	if (typeof crypto !== "undefined" && crypto.getRandomValues) {
		n = crypto.getRandomValues(new Uint32Array(1))[0];
	} else {
		n = Math.floor(Math.random() * 0xffffffff);
	}
	return n.toString(36).padStart(7, "0");
}

/**
 * Read the last-used seed from localStorage.
 * @returns {string|null} Stored seed or null.
 */
export function loadLastSeed() {
	try {
		return localStorage.getItem(STORAGE_KEY);
	} catch {
		return null;
	}
}

/**
 * Persist the last-used seed to localStorage.
 * @param {string} seed Seed to store.
 * @returns {void}
 */
export function saveLastSeed(seed) {
	try {
		localStorage.setItem(STORAGE_KEY, seed);
	} catch {
		/* storage unavailable — non-fatal. */
	}
}
