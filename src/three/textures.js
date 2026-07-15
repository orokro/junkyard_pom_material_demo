/**
 * ============================================================================
 * three/textures.js
 * ----------------------------------------------------------------------------
 * Texture loading for the POM tile sets (and the dirt floor set, used later).
 *
 * Asset URLs are resolved through Vite's import.meta.glob so the files under
 * assets/tex are fingerprinted into the build without moving Greg's folder.
 * Color spaces are set explicitly: albedo = sRGB, everything else (normal,
 * depth, metal, rough) = linear/no-color data.
 * ============================================================================
 */

import * as THREE from "three";

/** @type {Record<string, string>} filename -> fingerprinted URL. */
const TEX_URLS = (() => {
	const glob = import.meta.glob("../../assets/tex/*.png", {
		eager: true,
		query: "?url",
		import: "default",
	});
	/** @type {Record<string, string>} */
	const map = {};
	for (const [path, url] of Object.entries(glob)) {
		const file = path.split("/").pop();
		if (file) map[file] = /** @type {string} */ (url);
	}
	return map;
})();

const loader = new THREE.TextureLoader();

/**
 * @typedef {object} TileTextures
 * @property {number} index 1-based tile number.
 * @property {THREE.Texture} albedo
 * @property {THREE.Texture} normal
 * @property {THREE.Texture} metal
 * @property {THREE.Texture} rough
 * @property {THREE.Texture} depth
 */

/**
 * Load one texture with the right color space + wrapping + anisotropy.
 * @param {string} file Filename in assets/tex.
 * @param {boolean} srgb Whether it is color data (albedo).
 * @param {number} maxAniso Max anisotropy from renderer capabilities.
 * @returns {Promise<THREE.Texture>} Loaded texture.
 */
async function loadTex(file, srgb, maxAniso) {
	const url = TEX_URLS[file];
	if (!url) throw new Error(`Texture not found: ${file}`);
	const tex = await loader.loadAsync(url);
	tex.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
	tex.wrapS = THREE.RepeatWrapping;
	tex.wrapT = THREE.RepeatWrapping;
	tex.anisotropy = maxAniso;
	tex.needsUpdate = true;
	return tex;
}

/**
 * Load a single POM tile set by number (1-4).
 * @param {number} n Tile number.
 * @param {number} maxAniso Max anisotropy.
 * @returns {Promise<TileTextures>} Loaded tile textures.
 */
export async function loadTileSet(n, maxAniso) {
	const [albedo, normal, metal, rough, depth] = await Promise.all([
		loadTex(`jy_tile_${n}_albedo.png`, true, maxAniso),
		loadTex(`jy_tile_${n}_normal.png`, false, maxAniso),
		loadTex(`jy_tile_${n}_metal.png`, false, maxAniso),
		loadTex(`jy_tile_${n}_rough.png`, false, maxAniso),
		loadTex(`jy_tile_${n}_depth.png`, false, maxAniso),
	]);
	return { index: n, albedo, normal, metal, rough, depth };
}

/**
 * Load all four POM tile sets.
 * @param {number} maxAniso Max anisotropy.
 * @param {(loaded: number, total: number) => void} [onProgress] Progress callback.
 * @returns {Promise<TileTextures[]>} The four tile sets, in order.
 */
export async function loadAllTiles(maxAniso, onProgress) {
	/** @type {TileTextures[]} */
	const tiles = [];
	for (let n = 1; n <= 4; n++) {
		tiles.push(await loadTileSet(n, maxAniso));
		onProgress?.(n, 4);
	}
	return tiles;
}

/**
 * @typedef {object} DirtTextures
 * @property {THREE.Texture} albedo
 * @property {THREE.Texture} normal
 * @property {THREE.Texture} metal
 * @property {THREE.Texture} rough
 */

/**
 * Load the dirt floor texture set.
 * @param {number} maxAniso Max anisotropy.
 * @returns {Promise<DirtTextures>} Loaded dirt textures.
 */
export async function loadDirtTextures(maxAniso) {
	const [albedo, normal, metal, rough] = await Promise.all([
		loadTex("dry-dirt1-albedo.png", true, maxAniso),
		loadTex("dry-dirt1-normal2.png", false, maxAniso),
		loadTex("dry-dirt1-metalness.png", false, maxAniso),
		loadTex("dry-dirt1-roughness.png", false, maxAniso),
	]);
	return { albedo, normal, metal, rough };
}
