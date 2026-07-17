/**
 * ============================================================================
 * three/pomMaterial.js
 * ----------------------------------------------------------------------------
 * Parallax Occlusion Mapping (POM) material.
 *
 * Rather than write a PBR shader from scratch, we patch MeshStandardMaterial
 * via onBeforeCompile: a tangent-space raymarch against the depth map produces
 * a per-fragment UV offset, and that offset is added to every map sampler
 * (albedo / normal / metal / rough). This keeps ThreeJS lighting, IBL, tone
 * mapping, etc. for free — we only own the ~40 lines of parallax below.
 *
 * Depth convention: Greg authored white = surface (near/high), black = deep.
 * We convert to "depth from top" (0 at surface, 1 deepest) for the raymarch,
 * with a live invert toggle in case the math wants the opposite.
 *
 * Graceful degradation: uParallaxScale = 0 yields a zero offset, so the
 * material renders as ordinary PBR — a safe fallback if POM misbehaves.
 * ============================================================================
 */

import * as THREE from "three";

/** GLSL: build a tangent frame from screen-space derivatives (Schüler). */
const COTANGENT_FN = /* glsl */ `
mat3 jyCotangentFrame( vec3 N, vec3 p, vec2 uv ) {
	vec3 dp1 = dFdx( p );
	vec3 dp2 = dFdy( p );
	vec2 duv1 = dFdx( uv );
	vec2 duv2 = dFdy( uv );
	vec3 dp2perp = cross( dp2, N );
	vec3 dp1perp = cross( N, dp1 );
	vec3 T = dp2perp * duv1.x + dp1perp * duv2.x;
	vec3 B = dp2perp * duv1.y + dp1perp * duv2.y;
	float invmax = inversesqrt( max( dot( T, T ), dot( B, B ) ) );
	return mat3( T * invmax, B * invmax, N );
}
`;

/** GLSL: sample depth-from-top, and raymarch to a parallax UV offset. */
const PARALLAX_FN = /* glsl */ `
float jySampleDepth( vec2 uv ) {
	float h = texture2D( tDepth, uv ).r;   // white = surface (high)
	if ( uInvertDepth == 1 ) h = 1.0 - h;
	return 1.0 - h;                        // depth from top: 0 = surface, 1 = deep
}

vec2 jyParallaxOffset( vec2 uv, vec3 surfPos, vec3 N, vec3 Vdir ) {
	if ( uParallaxScale <= 0.0 ) return vec2( 0.0 );

	mat3 tbn = jyCotangentFrame( N, surfPos, uv );
	vec3 vTS = normalize( transpose( tbn ) * Vdir );   // view dir, tangent space
	float vz = max( vTS.z, 0.15 );                     // avoid grazing blowup

	float fSteps = float( uParallaxSteps );
	float layerDepth = 1.0 / fSteps;
	vec2 maxOffset = ( vTS.xy / vz ) * uParallaxScale;
	vec2 deltaUv = maxOffset / fSteps;

	float curLayer = 0.0;
	vec2 curUv = uv;
	float curDepth = jySampleDepth( curUv );

	const int JY_MAX_STEPS = 64;
	for ( int i = 0; i < JY_MAX_STEPS; i++ ) {
		if ( i >= uParallaxSteps ) break;
		if ( curLayer >= curDepth ) break;
		curUv -= deltaUv;
		curDepth = jySampleDepth( curUv );
		curLayer += layerDepth;
	}

	// Interpolate between the last two samples for a smooth intersection.
	vec2 prevUv = curUv + deltaUv;
	float afterD = curDepth - curLayer;
	float beforeD = jySampleDepth( prevUv ) - ( curLayer - layerDepth );
	float w = clamp( afterD / ( afterD - beforeD + 1e-5 ), 0.0, 1.0 );
	vec2 finalUv = mix( curUv, prevUv, w );
	return finalUv - uv;
}
`;

/**
 * @typedef {object} PomUniforms
 * @property {{value: THREE.Texture}} tDepth
 * @property {{value: number}} uParallaxScale
 * @property {{value: number}} uParallaxSteps
 * @property {{value: number}} uInvertDepth
 */

/**
 * @typedef {object} PomMaterial
 * @property {THREE.MeshStandardMaterial} material
 * @property {PomUniforms} uniforms
 * @property {(tile: import("./textures.js").TileTextures) => void} setTile
 * @property {(runtime: Record<string, *>) => void} applyRuntime
 */

/**
 * Create a POM-patched standard material for a tile set.
 * @param {import("./textures.js").TileTextures} tile Initial tile textures.
 * @param {Record<string, *>} runtime Runtime config (pomStrength/pomSteps/pomInvertDepth).
 * @returns {PomMaterial} Material handle.
 */
export function createPomMaterial(tile, runtime) {
	const material = new THREE.MeshStandardMaterial({
		map: tile.albedo,
		normalMap: tile.normal,
		metalnessMap: tile.metal,
		roughnessMap: tile.rough,
		metalness: 1.0,
		roughness: 1.0,
		envMapIntensity: 1.0,
	});

	/** @type {PomUniforms} */
	const uniforms = {
		tDepth: { value: tile.depth },
		uParallaxScale: { value: runtime.pomStrength ?? 0.06 },
		uParallaxSteps: { value: Math.round(runtime.pomSteps ?? 24) },
		uInvertDepth: { value: runtime.pomInvertDepth ? 1 : 0 },
		uRustTint: { value: runtime.rustTint ?? 0.6 },
		uTireDesat: { value: runtime.tireDesat ?? 0.7 },
	};
	material.userData.pomUniforms = uniforms;

	material.onBeforeCompile = (shader) => {
		Object.assign(shader.uniforms, uniforms);

		// Per-instance biome scalars (rust,tire,pits,paths) → varying for tinting.
		shader.vertexShader = shader.vertexShader
			.replace("#include <common>", "#include <common>\n\t\t\tattribute vec4 aBiome;\n\t\t\tvarying vec4 vBiome;")
			.replace("#include <begin_vertex>", "#include <begin_vertex>\n\t\t\tvBiome = aBiome;");

		// 1) Inject uniforms + helper functions after <common>.
		shader.fragmentShader = shader.fragmentShader.replace(
			"#include <common>",
			/* glsl */ `#include <common>
			uniform sampler2D tDepth;
			uniform float uParallaxScale;
			uniform int uParallaxSteps;
			uniform int uInvertDepth;
			uniform float uRustTint;
			uniform float uTireDesat;
			varying vec4 vBiome;
			${COTANGENT_FN}
			${PARALLAX_FN}`
		);

		// 2) Compute the offset once, early in main() (vMapUv/vNormal/vViewPosition in scope).
		shader.fragmentShader = shader.fragmentShader.replace(
			"#include <clipping_planes_fragment>",
			/* glsl */ `#include <clipping_planes_fragment>
			vec2 jyPomOffset = vec2( 0.0 );
			#ifdef USE_MAP
				jyPomOffset = jyParallaxOffset( vMapUv, -vViewPosition, normalize( vNormal ), normalize( vViewPosition ) );
			#endif`
		);

		// 3) Feed the offset UV to each map sampler. IMPORTANT: inside
		//    onBeforeCompile the fragment shader still holds raw `#include <...>`
		//    directives (three expands them AFTER this hook). So we replace the
		//    include with the chunk's own source, its UV varying offset by
		//    jyPomOffset. All our maps share uv channel 0, so the same offset
		//    applies to every sampler.
		const offsetChunk = (chunk, uvName) =>
			THREE.ShaderChunk[chunk].split(uvName).join(`( ${uvName} + jyPomOffset )`);
		// Biome tint applied to the sampled albedo: tire → desaturate, rust → orange.
		const jyTint = /* glsl */ `
			#ifdef USE_MAP
				{
					float jyLum = dot( diffuseColor.rgb, vec3( 0.299, 0.587, 0.114 ) );
					// Tire → desaturate hard toward a darkened grey (rubbery scrap).
					diffuseColor.rgb = mix( diffuseColor.rgb, vec3( jyLum * 0.75 ), clamp( vBiome.y * uTireDesat, 0.0, 1.0 ) );
					// Rust → strong orange keyed to the pixel's brightness (unmistakable).
					vec3 jyRust = jyLum * vec3( 1.55, 0.52, 0.18 ) + vec3( 0.06, 0.01, 0.0 );
					diffuseColor.rgb = mix( diffuseColor.rgb, jyRust, clamp( vBiome.x * uRustTint, 0.0, 1.0 ) );
				}
			#endif`;
		shader.fragmentShader = shader.fragmentShader
			.replace("#include <map_fragment>", offsetChunk("map_fragment", "vMapUv") + jyTint)
			.replace("#include <normal_fragment_maps>", offsetChunk("normal_fragment_maps", "vNormalMapUv"))
			.replace("#include <roughnessmap_fragment>", offsetChunk("roughnessmap_fragment", "vRoughnessMapUv"))
			.replace("#include <metalnessmap_fragment>", offsetChunk("metalnessmap_fragment", "vMetalnessMapUv"));
	};

	return {
		material,
		uniforms,
		setTile(next) {
			material.map = next.albedo;
			material.normalMap = next.normal;
			material.metalnessMap = next.metal;
			material.roughnessMap = next.rough;
			uniforms.tDepth.value = next.depth;
			material.needsUpdate = false; // same defines; just swapped texture objects
		},
		applyRuntime(cfg) {
			if (cfg.pomStrength !== undefined) uniforms.uParallaxScale.value = cfg.pomStrength;
			if (cfg.pomSteps !== undefined) uniforms.uParallaxSteps.value = Math.round(cfg.pomSteps);
			if (cfg.pomInvertDepth !== undefined) uniforms.uInvertDepth.value = cfg.pomInvertDepth ? 1 : 0;
			if (cfg.rustTint !== undefined) uniforms.uRustTint.value = cfg.rustTint;
			if (cfg.tireDesat !== undefined) uniforms.uTireDesat.value = cfg.tireDesat;
		},
	};
}
