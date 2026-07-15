/**
 * ============================================================================
 * three/catalog.js
 * ----------------------------------------------------------------------------
 * Phase 3.1 verification view: lays out every tile in the registry on a grid
 * with a floating name label, using a shared POM material. Lets us confirm
 * orientation, the re-zero anchor, and UVs before generating anything.
 *
 * Layout: tiles are placed at (col*SPACING, 0, row*SPACING) with min corner at
 * the cell origin, so each occupies [x..x+3] × [z..z+3]. A "+X → east" arrow is
 * included so ramp directions can be read against world axes.
 * ============================================================================
 */

import * as THREE from "three";

const COLS = 8;
const SPACING = 5;

/**
 * Build a canvas-textured label sprite.
 * @param {string} text Label text.
 * @returns {THREE.Sprite} Sprite with the rendered text.
 */
function makeLabel(text) {
	const canvas = document.createElement("canvas");
	const ctx = /** @type {CanvasRenderingContext2D} */ (canvas.getContext("2d"));
	const font = "26px monospace";
	ctx.font = font;
	const textW = Math.ceil(ctx.measureText(text).width);
	canvas.width = textW + 20;
	canvas.height = 40;
	// Re-fetch state (resizing the canvas resets the context).
	ctx.font = font;
	ctx.textBaseline = "middle";
	ctx.fillStyle = "rgba(10,13,18,0.82)";
	ctx.fillRect(0, 0, canvas.width, canvas.height);
	ctx.fillStyle = "#ffd23d";
	ctx.fillText(text, 10, canvas.height / 2 + 1);

	const tex = new THREE.CanvasTexture(canvas);
	tex.colorSpace = THREE.SRGBColorSpace;
	const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true }));
	const aspect = canvas.width / canvas.height;
	sprite.scale.set(aspect * 0.9, 0.9, 1);
	return sprite;
}

/**
 * @typedef {object} Catalog
 * @property {THREE.Group} group
 * @property {THREE.Vector3} center World-space center of the layout (for the camera).
 * @property {() => void} dispose
 */

/**
 * Build the tile catalog.
 * @param {import("./tiles.js").TileEntry[]} list Registry entries.
 * @param {THREE.Material} material Shared POM material.
 * @returns {Catalog} Catalog handle.
 */
export function buildCatalog(list, material) {
	const group = new THREE.Group();
	/** @type {THREE.Texture[]} */
	const labelTextures = [];
	/** @type {THREE.BufferGeometry[]} */
	const meshGeometries = [];

	list.forEach((entry, i) => {
		const col = i % COLS;
		const row = Math.floor(i / COLS);
		const x = col * SPACING;
		const z = row * SPACING;

		const mesh = new THREE.Mesh(entry.geometry, material);
		mesh.position.set(x, 0, z);
		group.add(mesh);
		meshGeometries.push(entry.geometry);

		const label = makeLabel(entry.name);
		label.position.set(x + 1.5, entry.height + 1.0, z + 1.5);
		group.add(label);
		labelTextures.push(/** @type {THREE.SpriteMaterial} */ (label.material).map);
	});

	const rows = Math.ceil(list.length / COLS);
	const center = new THREE.Vector3(((COLS - 1) * SPACING) / 2, 1.5, ((rows - 1) * SPACING) / 2);

	// East marker: an arrow pointing +X so ramp directions read against axes.
	const arrow = new THREE.ArrowHelper(
		new THREE.Vector3(1, 0, 0),
		new THREE.Vector3(-4, 0.1, -4),
		8,
		0xff8a3d,
		2,
		1.4
	);
	group.add(arrow);
	const eastLabel = makeLabel("+X  EAST");
	eastLabel.position.set(6, 1.2, -4);
	group.add(eastLabel);
	labelTextures.push(/** @type {THREE.SpriteMaterial} */ (eastLabel.material).map);

	return {
		group,
		center,
		dispose() {
			for (const g of meshGeometries) g.dispose();
			for (const t of labelTextures) t.dispose();
			material.dispose();
			arrow.dispose();
		},
	};
}
