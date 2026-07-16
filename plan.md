# Dumper Cars — Junkyard Generation WebGL POC — Plan

## Purpose
A ThreeJS WebGL demo to validate **procedural junkyard map generation** and the
**POM (Parallax Occlusion Mapping) PBR textures** before porting the approach to Unity.
This is a proof-of-concept for look/feel and generation strategy only — no gameplay,
no enemies, no collision. Free-fly through a procedurally generated, chunked, infinite
junkyard.

Rendering optimizations here are intentionally lightweight because Unity will redo its
own mesh/texture optimization on import. The value of this POC is the *generation* and
the *POM look*, not a shippable renderer.

---

## Tech Stack & Build
- **Vite + vanilla JS** (no framework). Three.js is the core; a framework adds overhead
  without benefit here.
- **Tweakpane** for the runtime settings sidebar (live shader + noise sliders).
- Hand-rolled HTML/CSS for the start screen (seed + world-gen form).
- **Three.js** for rendering, `GLTFLoader` for the GLB.
- Scripts: `npm run dev` (vite), `npm run build` (vite build → static `dist/`),
  `npm run preview` (local check of the build).
- **Static output** — `vite build` emits a fully static `dist/` (HTML/JS/assets),
  no runtime server or port proxying. Deployable to GitHub Pages or any static HTTPS host.
  - GitHub Pages serves from a subpath, so `vite.config.js` sets `base: './'` (relative)
    for portability.
  - Large binaries (9 MB GLB, ~90 MB textures) live in `public/assets/` and load by URL.
    Fine for personal/small-group use on good hardware; Unity port will use its own
    compressed textures.

---

## Coordinate Conventions (locked)
- World is **Y-up** (ThreeJS). GLB authored in Blender Z-up; `GLTFLoader` handles the
  Z-up→Y-up conversion, but the discovery script **verifies** this rather than assuming.
- **X = east (+)**, map spawns **+X only** (no −X). **Z = north/south** (Minecraft-style).
- Player starts at **X=0, Z=0** — center of the western edge (the wall that connects to
  the auto-shop). They fan out N/NE/E/SE/S.
- Chunk key: `` `${seed}_${cx}_${cz}` ``.
- Per-block deterministic randomness: hash of
  `` `${seed}_${cx}_${cz}_${colX}_${colZ}_${h}` `` → PRNG → texture-tile pick.
- **Zero `Math.random` in generation.** Everything derives from `seed` so all clients
  reproduce the identical map (multiplayer determinism, even though networking is out of
  scope here).

---

## Core Architecture Decisions (locked)

### 1. Global height field as a pure function
Height is a pure function of **world** coordinates — it knows nothing about chunks:

```
height(worldX, worldZ) = quantizeToMeters(
      maxHeightMeters
    * gradientEast(worldX)        // 0..1, ramps start→end over gradientWidth, clamps at 1.0
    * noise01(worldX, worldZ)     // fBm noise, 0..1, octaves/lacunarity/persistence
    * pathMask(worldX, worldZ)    // 1.0 = full height, 0.0 = ground; optional blurred falloff
)
```

- Adjacent chunks automatically agree at shared borders because the function is global —
  **no neighbor-chunk generation, no seam-blending, no chunk caching.** A chunk sampling a
  ramp cap just reads `height()` at the 4 neighbor columns (which may cross a chunk edge —
  fine, it's a pure sample).
- **`gradientEast` and `pathMask` are terms in this function that return 1.0 when disabled.**
  So the gradient and path phases are just enabling flags + tuning UI, not re-architecture.
  Build all three terms from day one; default gradient/path to identity until their phases.

### 2. Visible-shell generation (MVP: whole-tile instancing, no face chopping)
Bottoms and interiors are never visible (no tunneling), so never generate them.
- Per column, stack `flat_3` from the solid top **down only to `min(4 neighbor heights)`**.
  Below that line all four sides are covered → invisible → not emitted. This eliminates the
  buried-column blowup (the naive "fill to Y=0" or even "fill to chunk min_y" versions).
- Cap the `%3` remainder with `flat_1` / `flat_2`, or a ramp cap based on neighbor heights.
- Accept some back-to-back interior quads between stacked cubes — negligible on target GPUs.
- **Stretch goal (optional, late / may be skipped):** decompose tiles into per-normal face
  groups (N/E/S/W/top via dot-product tolerance against the ideal cardinal normal) and emit
  only exposed faces into a merged BufferGeometry. Elegant, but won't port to Unity and isn't
  needed to validate look/generation — explicitly optional.

### 3. Texture-array instancing for per-block texture variety
- Each block picks one of 4 tile sets from `seed + position` (not height — height alone
  would band identical textures across a layer and look ugly).
- Pack the 4 tile sets into a `DataArrayTexture` (one layer per tile set, per map type).
- Per-instance `tileIndex` attribute selects the layer in-shader.
- Result: **one InstancedMesh per tile geometry**, texture chosen per-instance. No draw-call
  multiplication, no runtime canvas stitching.

### 4. POM via `onBeforeCompile` patch of `MeshStandardMaterial`
- Do **not** write a PBR shader from scratch. Patch the standard material: inject a
  parallax-occlusion UV offset (raymarch the depth map in tangent space vs. view dir)
  **before** the albedo/normal/metal/rough samplers, feeding them the offset UVs.
- Keeps ThreeJS PBR lighting, IBL, and shadows for free.
- Depth map polarity: authored **white = surface (near), black = deep (far)**. Expose an
  **invert toggle** anyway in case the raymarch math wants the opposite convention.
- POM shifts interiors only — it cannot alter silhouettes, so cube/tile edges stay hard-flat.
  Acceptable for junk piles.
- Highest-risk item → built first, on a single cube, in ThreeJS Phase 1.

### 5. Pre-rotated tiles → pure-translation placement
- All corner/direction variants (ne/se/nw/sw, all ramp directions) were authored as
  **separate tiles with zero transform rotation**. Placement is **pure translation** — pick
  the correctly-named tile, never rotate. Generation just needs a name → geometry registry.
- Full ramp set is intentional for visual interest: 3 steepnesses (0→1, 0→2, 0→3) plus
  `flat_1`/`flat_2`/`flat_3`. Terrain is a "grid of third-slabs," not a Minecraft cube grid.
- MVP generates **N/S/E/W caps first** to lock behavior, then lights up the rest.

### 6. Chunk streaming
- LRU of active chunks keyed by `` `${cx}_${cz}` ``; generate on entering render distance,
  dispose + pool geometry/material on exit. Never persisted to disk (ephemeral per round).
- Generator is written as a **pure function returning transferable typed arrays**
  (instance matrices + tileIndices) so moving it into a **web worker** later is a copy-paste,
  not a rewrite. Workers deferred to the optimization phase.

---

## Configurable Parameters

### World generation (start-screen form)
- `seed` (text; roll-new button; last seed remembered in `localStorage`)
- `maxHeightMeters` (total max potential height, e.g. 200)
- Gradient: `gradientStart` (~0.0), `gradientEnd` (~1.0), `gradientWidthMeters` (default 200)
- Noise (full suite): octaves, frequency/scale, lacunarity, persistence, amplitude
- Paths: `numPaths`, `minSegments`, `maxSegments`, `segmentStepX` (default 10%),
  `segmentRangeZ` (default ±20%), `pathWorldSizeMeters` (default 400 sq, centered on Z),
  `pathThickness`, `pathBlur` (0 = sheer cliffs, >0 = blurred/ramped shoulders — toggleable)
- `chunkSize` (columns per side, e.g. 10 → 30 m), `renderDistance` (chunks)
- Floor tiling settings

### Runtime sidebar (Tweakpane, live)
- POM: parallax strength, ray steps, depth invert toggle, other shader knobs
- Fly camera speed / FOV
- Toggle interior-face culling (if stretch goal implemented)
- Return-to-home button
- (Regenerating world params requires re-generation, so those stay on the start screen /
  a "regenerate" action.)

---

## Deliverable Behavior
- Start screen: seed + world-gen form, prefilled defaults, roll-seed button, remembers last
  seed. Click **Start** → world generates, player placed at X=0/Z=0.
- Free-fly camera: **WASD + Shift (speed) + mouse look**. Sky-blue clear color.
- Chunks load/unload as you fly. POM visible on surfaces. Pseudo-infinite dirt floor at Y=0
  (camera-following plane with scrolling UVs; UVs use `fract` to avoid far-out precision loss).
- Pop-out sidebar for live tweaks.

---

## Phases

**Phase 0 — Discovery — ✅ DONE** (`scripts/discover-glb.mjs`, `npm run discover`)
Results — the GLB is clean, no corrective work needed:
- **75 mesh nodes, all names valid**, zero typos/dupes. The `.` in names survived the Blender
  export (generator: Khronos glTF Blender I/O v5.0.21). Full flat + ramp matrix present.
- **Orientation correct — no rotation fix needed.** Every tile imports as `[3, h, 3]` (X/Z
  footprint = 3 m, height in **Y**, h ∈ {1,2,3}). Blender Z-up→glTF Y-up conversion happened
  properly. (The script's "largest-dim axis" aggregate is a red herring here — X and Z tie at
  3 m, so it reports X; the per-tile footprint check is the authoritative confirmation.)
- **All tiles have UVs (TEXCOORD_0)** and reference a single shared material (his tiling
  preview mat — we ignore it and swap in the POM texture-array material at load).
- **Uniform re-zero anchor** (locks placement math): every tile's base sits at **Y=0**, and
  local geometry min corner is a constant **localMin = [0, 0, −3]** across all 75 tiles. So the
  local origin is the **(minX, bottom, maxZ) corner** — matches the "top-left/bottom corner"
  note. Placement rule: **strip the node's grid translation** (re-zero), then position a tile so
  its footprint fills a cell by adding `cellMinCorner − localMin`. Tiles are never rotated.

**Phase 0 (original spec) — Discovery (CLI node script, run first)**
Load `assets/models/jy_parts_v001.glb` and report, per mesh:
- name (validate against `` jyt_{flat|ramp}_{dir}_{lvl}_to_{lvl} `` convention; flag typos/dupes;
  note that Blender may have sanitized `.` or appended `.001` on export)
- bbox min/max/size (confirm 3 × h × 3 footprint; h ∈ {1,2,3})
- origin offset + grid offset (tiles are laid out in a grid in Blender → **re-zero each to a
  canonical local origin**, the authored top-left/bottom corner, discard grid position)
- shared-axis check (all tiles on a common flat axis = the tell for a bad Z-up/Y-up transform)
- UV + material presence
Output a tile registry the generator consumes. Decide any corrective transforms from results.

**Phase 1 — UI skeleton — ✅ DONE**
Vite + vanilla + Tweakpane scaffold. Single-source config schema drives both the start-screen
form and the runtime sidebar. Seed roll + localStorage persistence. `npm run dev` / `build`
emit a runtime-free static `dist/` (base `./` for GitHub Pages).

**Phase 2 — ThreeJS: POM cube + fly cam — ✅ DONE**
POM works. `MeshStandardMaterial` patched via `onBeforeCompile` with a tangent-space
parallax-occlusion raymarch (cotangent-frame TBN, no vertex tangents needed), live
strength/steps/invert uniforms, graceful degrade to plain PBR at strength 0. Pointer-lock fly
cam (WASD + Shift + Space/C). Tile 1-4 preview switcher. Dialed-in defaults: **strength 0.115,
steps 30**.
- Key gotcha recorded: inside `onBeforeCompile` the fragment shader still holds raw
  `#include <...>` directives (expanded *after* the hook), so the offset must be injected by
  replacing the `#include <map_fragment>` etc. with the chunk body + offset UV — not by patching
  the expanded `texture2D(...)` calls (which aren't there yet).

**Floor — ✅ DONE** (pulled ahead of Phase 3)
Pseudo-infinite dirt floor at Y=0: a large plane recentered under the camera each frame with
world-locked scrolling UVs (`three/floor.js`). Tile size + visibility moved out of the world-gen
form into **live runtime controls** (sidebar "Floor" group) since it's dynamic, not chunk-based.

**Phase 3 — ThreeJS: noise map generation**
- (3.1) ✅ GLB loaded, tile registry re-zeroed to `[0,0,0]` min corner, catalog view verified.
- (3.2) ✅ Single chunk from the global height field (noise only), per-block texture variety via
  4 POM materials instanced per (tile, set). Debug flat-shade + wireframe toggles added.
- (3.2b top-tiling) ✅ **Corner (vertex) height model.** Height sampled at cell corners; each cell
  best-fits its 4 corners against all 12 tile signatures (edge/convex/concave — signatures
  verified against the GLB geometry). Exact where possible; ≤1 m seam otherwise (`MAX_SEAM`);
  >3 m spread or saddle → anchor to lowest corner (cliff). Continuous by construction.
  - ⏳ **Revisit later** (Greg to marinate): occasional "pokies" / the 1 m best-fit seams on
    3-level diagonal cells. Model is good enough to build on; polish the top layer later.
- (3.3) ✅ **Chunk streaming/unloading** (`gen/chunkManager.js`): active-set keyed by chunk,
  generate nearest-first within render distance (+X only, cx≥0), dispose out of range, 2/frame
  budget after a prime, per-chunk frustum culling, live HUD stats. Border corners share world
  coords → seams continuous. Shell/buried-face optimization still parked for the perf pass.

**Phase 4 — Eastward gradient — ✅ DONE**
`gradientEast(wx)` in the height field: lerps `gradientStart`→`gradientEnd` over
`gradientWidthMeters` then holds. West spawn starts shallow (~2% height), rises to max potential
by the gradient width. `gradientEnabled` toggles it. Verified: mean height ~7 m at spawn → ~75 m
out east (noise still drives peaks).

**Phase 5 — Paths — ✅ DONE**
`pathMask(wx,wz)` in the height field: seeded "lightning" polylines fanning east from spawn
(0,0), each with min–max segments stepping east and wandering ±range in Z. Mask is a
distance-to-polyline: 0 on a path (held at ground level), 1 off, smoothstep shoulder over
`pathBlur` (0 = sheer cliffs). Bbox early-out keeps it cheap outside the path field. Points-array
approach chosen over a rasterized image (analytic, smooth, no resolution artifacts); image mask
remains a possible later experiment. All params wired; `pathsEnabled` toggles.

**Bonus polish — ✅ DONE**
Walk/FPS camera (Tab toggle, default; height-field-sampled surface + eye height; slower than
fly). Full settings persistence (localStorage) + human-scale defaults (maxH 30, renderDist 12,
noiseScale 60). Baked-mesh .glb export of the ~160 m slice around the camera (single merged mesh
so GLTFExporter doesn't choke on thousands of InstancedMesh nodes). Live post-FX shader pad
(persisted, off by default; posterize + depth-atmosphere default).

---

## Phase 7 — Biomes, structures & set pieces (in progress)

"Biomes" = overlapping regional variations that stack. Assets in
`assets/models/jy_structures_library.glb` (`group_global` / `group_tire` / `group_rust`) named
`item_{NxN}_(odds_)(mod_)snake_name`; multi-material items import as groups of child meshes.
New POM sets `jy_rust_*`, `jy_tires_*` (1588², uniform with the base tiles).

**Global biome field** — `biomesAt(wx,wz) → {rust, tire, pits, paths}`, each 0–1: a large-scale
seeded fBm per biome, thresholded then normalised (threshold→1). Sampled per column for blending
and at chunk-centre to gate structure spawning. Chunks can be several biomes at once (additive).

**Build order (reordered — risky shader last):**
1. ✅/⏳ **Biome field + terrain effects** (this step): pits (holey noise punches ground even out
   east) + paths-biome (Worley/Voronoi F1-edge lanes), multiplied into height scaled by biome-ness.
   `height = maxH·gradient·noise·spawnPathMask·lerp(1,holey,pits)·lerp(1,voronoiEdges,paths)`.
2. **Structure placement**: library loader + `item_` parser; per-chunk pool from active biome
   groups + globals (odds-gated; crane also mod-gated, `odds=3 mod=4`, container `odds=15`).
   `maxStructuresPerChunk` scaled by biome-ness, additively capped. Claimed-grid + size rules
   (1×1 random 90° rot; NxN neighbour-fit with seed-random start direction; SW-corner pivot).
   Instanced per item child-mesh.
3. **Texture-array + per-instance biome attributes** (done LAST — un-headless-testable shader):
   pack 6 POM sets (base ×4 + rust + tire) into `DataArrayTexture`s (~400 MB), one InstancedMesh
   per geometry with `aTexLayer` (highest-biome-over-threshold, else base-by-hash) + `aBiome`
   vec4 (continuous rust tint / tire desat). Collapses the ×4-material split → the deferred
   draw-call win, plus biome textures. Dummy 1×1 maps keep MeshStandardMaterial's UV/tangent
   plumbing; onBeforeCompile swaps samplers for `sampler2DArray` at the per-instance layer.

**Confirmed:** biome key `tire`; un-tagged globals default to a config "global odds"; crane
`mod=4`; texture-array refactor is on (step 3).

---

## Open Items / Risks
- **POM shader** is the top risk — de-risked by building it first (Phase 2) on one cube.
- **Path implementation**: points-array vs. rasterized-image mask. Image mask allows richer
  post-processing/drawing experiments; points-array is lighter. Decide at Phase 5; both use
  the seeded PRNG. Leaning image-mask for experimentation headroom.
- **Ramp-cap selection logic** (which named ramp/corner given 4 neighbor heights) is the
  fiddliest generation code — start with N/S/E/W, expand to corners + steepnesses.
- **75 tile geometries** → up to 75 InstancedMeshes per chunk (only instantiate those actually
  used per chunk). Fine on target hardware.

---

## Project Conventions (for code phases)
Tabs (not spaces); prefer semicolons; JSDoc on all methods/functions; comment block header
at the top of every file.
