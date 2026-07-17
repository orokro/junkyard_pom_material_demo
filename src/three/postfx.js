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

/** Default effect: desaturate + shadow tint + depth edges + gradient distance fog. */
export const DEFAULT_POST_SHADER = /* glsl */ `// ---- settings ----
const float EDGE_THICKNESS = 0.0;                    // width of the sketchy outlines
const vec3  SHADOW_TINT    = vec3(0.15, 0.05, 0.05);
const vec3  LINE_COLOR     = vec3(0.20, 0.15, 0.35);
const vec3  FOG_NEAR       = vec3(1.00, 0.75, 0.85);
const vec3  FOG_FAR        = vec3(0.65, 0.85, 1.00);
const float FOG_START      = 10.0;
const float FOG_END        = 90.0;
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

vec3 rgb2hsv( vec3 c ) {
	vec4 K = vec4( 0.0, -1.0 / 3.0, 2.0 / 3.0, -1.0 );
	vec4 p = mix( vec4( c.bg, K.wz ), vec4( c.gb, K.xy ), step( c.b, c.g ) );
	vec4 q = mix( vec4( p.xyw, c.r ), vec4( c.r, p.yzx ), step( p.x, c.r ) );
	float d = q.x - min( q.w, q.y );
	float e = 1.0e-10;
	return vec3( abs( q.z + ( q.w - q.y ) / ( 6.0 * d + e ) ), d / ( q.x + e ), q.x );
}

vec3 hsv2rgb( vec3 c ) {
	vec4 K = vec4( 1.0, 2.0 / 3.0, 1.0 / 3.0, 3.0 );
	vec3 p = abs( fract( c.xxx + K.xyz ) * 6.0 - K.www );
	return c.z * mix( K.xxx, clamp( p - K.xxx, 0.0, 1.0 ), c.y );
}

void main() {
	vec2 wobble = vec2( sin( vUv.y * 150.0 + uTime * 6.0 ), cos( vUv.x * 150.0 + uTime * 6.0 ) ) * 0.0003;
	vec2 edgeUv = vUv + wobble;
	vec3 col = texture2D( tDiffuse, vUv ).rgb;
	float rawDepth = texture2D( tDepth, vUv ).x;
	float depth = linearDepth( rawDepth );
	vec3 hsv = rgb2hsv( col );

	float satFactor = smoothstep( 0.3, 0.8, hsv.y );
	hsv.y = mix( hsv.y, hsv.y * 0.5, satFactor );
	hsv.z = mix( hsv.z, min( hsv.z + 0.3, 1.0 ), satFactor );
	float darkFactor = ( 1.0 - smoothstep( 0.0, 0.3, hsv.z ) ) * ( 1.0 - smoothstep( 0.0, 0.4, hsv.y ) );
	vec3 shadowHsv = rgb2hsv( SHADOW_TINT );
	hsv = mix( hsv, shadowHsv, darkFactor * 0.8 );

	col = hsv2rgb( hsv );
	vec2 texel = ( 1.0 / uResolution ) * EDGE_THICKNESS;

	float d1 = linearDepth( texture2D( tDepth, edgeUv + vec2( -texel.x, 0.0 ) ).x );
	float d2 = linearDepth( texture2D( tDepth, edgeUv + vec2( texel.x, 0.0 ) ).x );
	float d3 = linearDepth( texture2D( tDepth, edgeUv + vec2( 0.0, -texel.y ) ).x );
	float d4 = linearDepth( texture2D( tDepth, edgeUv + vec2( 0.0, texel.y ) ).x );

	float edge = abs( d1 - d2 ) + abs( d3 - d4 );
	float edgeWeight = smoothstep( 0.02, 0.1, edge / ( depth * 0.15 + 1.0 ) );
	col = mix( col, LINE_COLOR, edgeWeight );

	float fogFactor = clamp( ( depth - FOG_START ) / ( FOG_END - FOG_START ), 0.0, 1.0 );
	vec3 fogColor = mix( FOG_NEAR, FOG_FAR, vUv.y );
	col = mix( col, fogColor, fogFactor );
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
