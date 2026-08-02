/**
 * ============================================================================
 * arena/three/textures.js
 * ----------------------------------------------------------------------------
 * Texture loading for the Arena POC's floor material set.
 *
 * The arena uses its own "arena_floor" PBR set (albedo / normal / metal / rough)
 * instead of the junkyard's dirt. Asset URLs are resolved through Vite's
 * import.meta.glob so files under assets/tex are fingerprinted into the build
 * without moving Greg's folder.
 *
 * The set is OPTIONAL for now: if the arena_floor_*.png files are not present
 * yet, loadArenaFloorTextures() returns null and the floor falls back to a
 * generated placeholder (see floor.js). Drop these files into assets/tex to
 * light up the real material with no code changes:
 *
 *   arena_floor_albedo.png   (colour — sRGB)     [required to use the real set]
 *   arena_floor_normal.png   (normal — linear)   [optional]
 *   arena_floor_metal.png    (metalness — linear)[optional]
 *   arena_floor_rough.png    (roughness — linear)[optional]
 *
 * Color spaces are set explicitly: albedo = sRGB, everything else = linear.
 * ============================================================================
 */

import * as THREE from "three";

/** @type {Record<string, string>} filename -> fingerprinted URL. */
const TEX_URLS = (() => {
	const glob = import.meta.glob("../../../assets/tex/arena_floor_*.png", {
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
 * @typedef {object} ArenaFloorTextures
 * @property {THREE.Texture} albedo
 * @property {THREE.Texture} [normal]
 * @property {THREE.Texture} [metal]
 * @property {THREE.Texture} [rough]
 */

/**
 * Load the arena-floor texture set, if present.
 * @param {number} maxAniso Max anisotropy.
 * @returns {Promise<ArenaFloorTextures|null>} The set, or null if not shipped yet.
 */
export async function loadArenaFloorTextures(maxAniso) {
	if (!TEX_URLS["arena_floor_albedo.png"]) return null;

	/** @type {ArenaFloorTextures} */
	const out = { albedo: await loadTex("arena_floor_albedo.png", true, maxAniso) };
	if (TEX_URLS["arena_floor_normal.png"]) out.normal = await loadTex("arena_floor_normal.png", false, maxAniso);
	if (TEX_URLS["arena_floor_metal.png"]) out.metal = await loadTex("arena_floor_metal.png", false, maxAniso);
	if (TEX_URLS["arena_floor_rough.png"]) out.rough = await loadTex("arena_floor_rough.png", false, maxAniso);
	return out;
}
