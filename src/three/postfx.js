/**
 * ============================================================================
 * three/postfx.js
 * ----------------------------------------------------------------------------
 * Minimal fullscreen post-processing pipeline with a live-editable fragment
 * shader. The scene renders into a render target (colour + depth); a fullscreen
 * quad then runs the user's fragment shader over it.
 *
 * Shader contract (available to pasted code):
 *   varying vec2 vUv;              // screen UV 0..1
 *   uniform sampler2D tDiffuse;    // rendered scene colour (display space)
 *   uniform sampler2D tDepth;      // scene depth (non-linear, .x in 0..1)
 *   uniform vec2  uResolution;     // pixels
 *   uniform float uTime;           // seconds
 *   uniform float uNear, uFar;     // camera planes (for linearising depth)
 *   → write gl_FragColor.
 *
 * A broken shader just renders wrong — untick the toggle to recover. The RT
 * texture is stored in sRGB so tDiffuse looks like the on-screen image.
 * ============================================================================
 */

import * as THREE from "three";

const PASS_VERTEX = /* glsl */ `
varying vec2 vUv;
void main() {
	vUv = uv;
	gl_Position = vec4( position.xy, 0.0, 1.0 );
}
`;

/** Default effect: posterize + depth-based atmospheric haze. */
export const DEFAULT_POST_SHADER = /* glsl */ `// ---- settings ----
const float LEVELS    = 6.0;                 // posterize colour bands
const vec3  HAZE       = vec3(0.80, 0.83, 0.90);
const float FOG_START  = 40.0;               // metres — haze begins
const float FOG_END    = 500.0;              // metres — full haze
const float FOG_AMOUNT = 0.85;               // 0..1 max haze
// -------------------
varying vec2 vUv;
uniform sampler2D tDiffuse;
uniform sampler2D tDepth;
uniform vec2  uResolution;
uniform float uTime;
uniform float uNear;
uniform float uFar;

float linearDepth( float d ) {
	float z = d * 2.0 - 1.0;
	return ( 2.0 * uNear * uFar ) / ( uFar + uNear - z * ( uFar - uNear ) );
}

void main() {
	vec3 col = texture2D( tDiffuse, vUv ).rgb;

	// posterize
	col = floor( col * LEVELS + 0.5 ) / LEVELS;

	// depth haze — lighten distant geometry
	float dist = linearDepth( texture2D( tDepth, vUv ).x );
	float fog = clamp( ( dist - FOG_START ) / ( FOG_END - FOG_START ), 0.0, 1.0 );
	col = mix( col, HAZE, fog * FOG_AMOUNT );

	gl_FragColor = vec4( col, 1.0 );
}
`;

/**
 * @typedef {object} PostFX
 * @property {(w: number, h: number) => void} setSize
 * @property {(frag: string) => void} setShader
 * @property {(on: boolean) => void} setEnabled
 * @property {(scene: THREE.Scene, camera: THREE.Camera, dt: number) => void} render
 * @property {() => void} dispose
 */

/**
 * Create the post-processing pipeline.
 * @param {THREE.WebGLRenderer} renderer
 * @returns {PostFX}
 */
export function createPostFX(renderer) {
	const rt = new THREE.WebGLRenderTarget(1, 1, {
		depthTexture: new THREE.DepthTexture(1, 1),
		depthBuffer: true,
		stencilBuffer: false,
	});
	rt.texture.colorSpace = THREE.SRGBColorSpace;
	rt.texture.minFilter = THREE.LinearFilter;
	rt.texture.magFilter = THREE.LinearFilter;

	const uniforms = {
		tDiffuse: { value: rt.texture },
		tDepth: { value: rt.depthTexture },
		uResolution: { value: new THREE.Vector2(1, 1) },
		uTime: { value: 0 },
		uNear: { value: 0.1 },
		uFar: { value: 6000 },
	};

	const quadScene = new THREE.Scene();
	const quadCam = new THREE.Camera();
	const quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), makeMaterial(DEFAULT_POST_SHADER));
	quad.frustumCulled = false;
	quadScene.add(quad);

	let enabled = false;

	/** @param {string} frag @returns {THREE.ShaderMaterial} */
	function makeMaterial(frag) {
		return new THREE.ShaderMaterial({
			uniforms,
			vertexShader: PASS_VERTEX,
			fragmentShader: frag,
			depthTest: false,
			depthWrite: false,
		});
	}

	return {
		setSize(w, h) {
			rt.setSize(w, h);
			uniforms.uResolution.value.set(w, h);
		},
		setShader(frag) {
			const next = makeMaterial(frag);
			const old = quad.material;
			quad.material = next;
			if (Array.isArray(old)) old.forEach((m) => m.dispose());
			else old.dispose();
		},
		setEnabled(on) {
			enabled = on;
		},
		render(scene, camera, dt) {
			if (!enabled) {
				renderer.setRenderTarget(null);
				renderer.render(scene, camera);
				return;
			}
			uniforms.uNear.value = camera.near;
			uniforms.uFar.value = camera.far;
			uniforms.uTime.value += dt || 0;
			renderer.setRenderTarget(rt);
			renderer.render(scene, camera);
			renderer.setRenderTarget(null);
			renderer.render(quadScene, quadCam);
		},
		dispose() {
			rt.dispose();
			rt.depthTexture.dispose();
			quad.geometry.dispose();
			const m = quad.material;
			if (Array.isArray(m)) m.forEach((x) => x.dispose());
			else m.dispose();
		},
	};
}
