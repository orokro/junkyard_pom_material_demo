/**
 * ============================================================================
 * arena/gen/dominoes.js
 * ----------------------------------------------------------------------------
 * Deterministic randomized domino tiler for an arbitrary set of grid cells.
 *
 * A "domino" covers two orthogonally-adjacent cells — exactly a shipping
 * container / bridge footprint (2x1 or 1x2). Given a set of cells, we find a
 * perfect matching on the grid graph (bipartite by checkerboard parity) using
 * Kuhn's augmenting-path algorithm, with RNG-shuffled adjacency so orientations
 * vary run to run but stay reproducible per seed.
 *
 * Used for: outer-ring fill (P5), level-3 island fill + tileability checks (P6).
 * A region is domino-tileable iff every cell gets matched (unmatched is empty).
 *
 * Pure module — Node-testable.
 * ============================================================================
 */

import { key } from "./grid.js";

const DIRS = [
	[1, 0],
	[-1, 0],
	[0, 1],
	[0, -1],
];

/**
 * Fisher-Yates shuffle in place using a [0,1) rng.
 * @template T @param {T[]} arr @param {() => number} rng @returns {T[]}
 */
function shuffle(arr, rng) {
	for (let i = arr.length - 1; i > 0; i--) {
		const j = Math.floor(rng() * (i + 1));
		[arr[i], arr[j]] = [arr[j], arr[i]];
	}
	return arr;
}

/**
 * @typedef {object} Domino
 * @property {[number, number]} a  First cell [cx, cz].
 * @property {[number, number]} b  Second cell [cx, cz].
 * @property {"H"|"V"} orient  H = east-west (same z), V = north-south (same x).
 */

/**
 * Tile a set of cells with dominoes.
 * @param {[number, number][]} cells  Cells to tile.
 * @param {() => number} rng  Deterministic [0,1) generator.
 * @returns {{ dominoes: Domino[], unmatched: [number, number][] }}
 */
export function tileDominoes(cells, rng) {
	const present = new Set(cells.map(([x, z]) => key(x, z)));

	// Split by checkerboard parity. Match A (even) -> B (odd).
	const aCells = [];
	for (const [x, z] of cells) {
		if (((x + z) & 1) === 0) aCells.push([x, z]);
	}
	shuffle(aCells, rng);

	/** @type {Map<string,string>} B-key -> matched A-key. */
	const matchB = new Map();
	/** @type {Map<string,[number,number]>} key -> cell. */
	const cellOf = new Map(cells.map((c) => [key(c[0], c[1]), c]));

	/**
	 * Try to find an augmenting path from A-cell a.
	 * @param {[number,number]} a @param {Set<string>} seen @returns {boolean}
	 */
	function augment(a, seen) {
		const dirs = shuffle(DIRS.slice(), rng);
		for (const [dx, dz] of dirs) {
			const bx = a[0] + dx;
			const bz = a[1] + dz;
			const bk = key(bx, bz);
			if (!present.has(bk) || seen.has(bk)) continue;
			seen.add(bk);
			const cur = matchB.get(bk);
			if (cur === undefined || augment(cellOf.get(cur), seen)) {
				matchB.set(bk, key(a[0], a[1]));
				return true;
			}
		}
		return false;
	}

	for (const a of aCells) augment(a, new Set());

	// Assemble dominoes from the matching.
	const dominoes = [];
	const matchedKeys = new Set();
	for (const [bk, ak] of matchB.entries()) {
		const b = cellOf.get(bk);
		const a = cellOf.get(ak);
		matchedKeys.add(ak);
		matchedKeys.add(bk);
		const orient = a[1] === b[1] ? "H" : "V";
		dominoes.push({ a, b, orient });
	}

	const unmatched = cells.filter((c) => !matchedKeys.has(key(c[0], c[1])));
	return { dominoes, unmatched };
}
