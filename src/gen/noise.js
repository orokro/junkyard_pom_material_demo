/**
 * ============================================================================
 * gen/noise.js
 * ----------------------------------------------------------------------------
 * Zero-dependency seeded 2D simplex noise + fBm.
 *
 * The permutation table is shuffled by our own seeded PRNG (seed.js), so the
 * noise field is fully deterministic per seed — every client reproduces the
 * same terrain. Simplex implementation follows Gustavson/Ashima; the value is
 * roughly in [-1, 1].
 * ============================================================================
 */

import { makeRng } from "../seed.js";

const F2 = 0.5 * (Math.sqrt(3) - 1);
const G2 = (3 - Math.sqrt(3)) / 6;
// 2D projections of the classic 12 gradient directions.
const GRAD = [
	[1, 1], [-1, 1], [1, -1], [-1, -1],
	[1, 0], [-1, 0], [1, 0], [-1, 0],
	[0, 1], [0, -1], [0, 1], [0, -1],
];

/**
 * Create a seeded 2D simplex noise function.
 * @param {string} seed Seed string.
 * @param {string} [salt] Namespacing salt (distinct fields from one seed).
 * @returns {(x: number, y: number) => number} Noise sampler, ~[-1, 1].
 */
export function createSimplex2D(seed, salt = "noise") {
	const rng = makeRng(seed, salt);
	const p = new Uint8Array(256);
	for (let i = 0; i < 256; i++) p[i] = i;
	for (let i = 255; i > 0; i--) {
		const j = Math.floor(rng() * (i + 1));
		const t = p[i];
		p[i] = p[j];
		p[j] = t;
	}
	const perm = new Uint8Array(512);
	const permMod12 = new Uint8Array(512);
	for (let i = 0; i < 512; i++) {
		perm[i] = p[i & 255];
		permMod12[i] = perm[i] % 12;
	}

	return function noise2D(xin, yin) {
		const s = (xin + yin) * F2;
		const i = Math.floor(xin + s);
		const j = Math.floor(yin + s);
		const t = (i + j) * G2;
		const x0 = xin - (i - t);
		const y0 = yin - (j - t);

		let i1, j1;
		if (x0 > y0) {
			i1 = 1;
			j1 = 0;
		} else {
			i1 = 0;
			j1 = 1;
		}
		const x1 = x0 - i1 + G2;
		const y1 = y0 - j1 + G2;
		const x2 = x0 - 1 + 2 * G2;
		const y2 = y0 - 1 + 2 * G2;

		const ii = i & 255;
		const jj = j & 255;
		const gi0 = permMod12[ii + perm[jj]];
		const gi1 = permMod12[ii + i1 + perm[jj + j1]];
		const gi2 = permMod12[ii + 1 + perm[jj + 1]];

		let n0 = 0;
		let t0 = 0.5 - x0 * x0 - y0 * y0;
		if (t0 >= 0) {
			t0 *= t0;
			n0 = t0 * t0 * (GRAD[gi0][0] * x0 + GRAD[gi0][1] * y0);
		}
		let n1 = 0;
		let t1 = 0.5 - x1 * x1 - y1 * y1;
		if (t1 >= 0) {
			t1 *= t1;
			n1 = t1 * t1 * (GRAD[gi1][0] * x1 + GRAD[gi1][1] * y1);
		}
		let n2 = 0;
		let t2 = 0.5 - x2 * x2 - y2 * y2;
		if (t2 >= 0) {
			t2 *= t2;
			n2 = t2 * t2 * (GRAD[gi2][0] * x2 + GRAD[gi2][1] * y2);
		}
		return 70 * (n0 + n1 + n2);
	};
}

/**
 * Create a fractal-Brownian-motion sampler over seeded simplex noise.
 * @param {string} seed Seed string.
 * @param {{octaves: number, lacunarity: number, persistence: number}} opts fBm params.
 * @param {string} [salt] Namespacing salt.
 * @returns {(x: number, y: number) => number} fBm sampler, ~[-1, 1].
 */
export function createFbm(seed, opts, salt = "fbm") {
	const noise = createSimplex2D(seed, salt);
	const octaves = Math.max(1, Math.round(opts.octaves));
	const { lacunarity, persistence } = opts;
	return function fbm(x, y) {
		let amp = 1;
		let freq = 1;
		let sum = 0;
		let norm = 0;
		for (let o = 0; o < octaves; o++) {
			sum += amp * noise(x * freq, y * freq);
			norm += amp;
			amp *= persistence;
			freq *= lacunarity;
		}
		return sum / norm;
	};
}
