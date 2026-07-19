# 🗑️ Dumper Cars — Junkyard Generation POC

> *Elevator pitch: what if Bumper Cars had Jiggle Physics?*

A WebGL / Three.js sandbox that procedurally generates an **infinite, seed-driven junkyard** — endless mounds of scrap you can walk and fly through. It exists to answer two questions **before** any of this gets rebuilt in Unity:

1. Do the custom **POM (Parallax Occlusion Mapping) PBR textures** actually read as deep, chunky junk?
2. Does the **chunk-based map-generation strategy** — heightfield + biomes + structures — hold up and feel good to move through?

No gameplay, no enemies, no collision. Just the *look* and the *generation*. Rendering is deliberately lightweight because Unity will redo its own mesh/texture optimization on import — the value here is the generator and the POM look, not a shippable renderer.

---

## Quick start

```bash
npm install
npm run dev       # local dev server (Vite)
npm run build     # static build → dist/
npm run preview   # serve the built dist/ locally
npm run discover  # inspect a .glb (bbox / orientation / materials)
```

Open the dev URL, pick a seed on the start screen, tweak the world settings (or roll with the defaults), and hit **Generate**.

---

## Controls

| Input | Action |
|---|---|
| **Click** | Capture mouse (pointer lock) to look around |
| **W A S D** | Move |
| **Shift** | Boost (3× speed) |
| **Tab** | Toggle **walk** ⇄ **fly** |
| **Space / C** | Fly up / down (fly mode) |
| **Esc** | Release the mouse |

You spawn **walking**, glued to the surface at human eye height. **Fly** frees you into full 6-DOF. You can't cross west through the boundary wall — the yard runs infinitely **east**.

---

## What's in the box

- **Infinite, deterministic world.** Same seed → same junkyard, forever. Chunks stream in around you (nearest-first, time-sliced so fast flight stays smooth) and dispose as you leave.
- **Corner-based terrain.** Heights are sampled at cell *corners* and matched against 12 hand-verified tile signatures (flats, ramps, wedges) so neighbouring tiles always agree at their shared edges — no cracks, no impossible back-to-back ramps.
- **Biomes that stack.** Independent large-scale noise fields for **rust**, **tire**, **pits**, and **paths**, each thresholded and re-normalized so you get distinct patches *and* overlaps *and* plain "vanilla" scrap. Rust/tire swap in dedicated POM texture sets; pits punch holes to ground; paths carve Voronoi canyons.
- **POM materials.** `MeshStandardMaterial` patched via `onBeforeCompile` — a tangent-space raymarch against a depth map fakes real surface depth while keeping Three's lighting, IBL, and tone mapping for free. Falls back to plain PBR if strength is zeroed.
- **Structures.** A Blender GLB library (cranes, containers, tire stacks…) placed on the surface with a claimed-grid packer, biome gating, rarity odds, and seeded rotation.
- **Faked infinities.** The dirt floor and the western **boundary wall** both scroll/re-tile around the camera instead of being real geometry — cheap, seamless, and hidden by fog long before any pop-in.
- **Live post-processing pad.** Paste a fragment shader (with access to colour + depth + time) and hit apply. Ships with an atmospheric fog/desaturate/edge shader on by default.
- **One-click Blender export.** Bakes the nearby world — terrain split by biome material *plus* all structures with their own materials — into a single textured `.glb` so you can drop the whole scene into Blender and check scale/cohesion.
- **Everything persists.** World settings and your post-FX shader are saved to `localStorage`, so a refresh drops you back where you left off.

---

## Under the hood

**Seeding.** A string seed goes through `cyrb128` → `mulberry32` to make a fast, deterministic PRNG. Every subsystem gets its own *salted* stream (`makeRng(seed, "paths")`, `"biome_rust"`, etc.) so they're independent but reproducible.

**Height field** (`gen/heightField.js`) is one pure function of world coordinates:

```
height = maxH · gradientEast · noise01 · spawnPathMask · pitsFactor · pathsBiomeFactor
```

Simplex fBm builds the base mounds; an eastward gradient keeps spawn low and grows the piles into mountains as you head east; a set of seeded "lightning" lanes fan out from spawn as clear walkways. Biomes then bend the terrain on top.

**Biome distribution.** Raw fBm is bell-shaped (everything clusters near the middle), which made early biomes weak and always-overlapping. A `smoothstep` contrast remap stretches each field across the full 0–1 range, so cutoffs behave intuitively and cores reach full strength. A **spawn-clear gate** ramps the terrain-carving biomes (pits/paths) in from the west, so spawn stays open instead of getting gutted by canyons.

**Chunk streaming** (`gen/chunkManager.js`) keeps an LRU active set keyed by `cx_cz`, generates within a circular render distance (+X only), and caps per-frame work to a time budget (always making at least one chunk of progress) so boosting never hitches. Terrain instances share the tile registry's vertex buffers and carry only a tiny per-chunk `aBiome` attribute.

**Coordinates.** Y-up (Three). **X = east (+)**, map is +X only; **Z = north/south**. GLBs authored Z-up in Blender; the loader converts, and the discovery script *verifies* rather than assumes.

---

## Settings

The start screen configures **world** parameters (require regeneration); the in-game sidebar tweaks **runtime** parameters (live).

**World** — seed · terrain height & chunk size · render distance · noise (scale/octaves/lacunarity/persistence/amplitude) · eastward gradient · spawn paths · biomes (region size, per-biome cutoffs, pit size/density, path lane width, spawn-clear gate) · structures (density, global odds).

**Runtime** — POM strength / steps / invert · rust tint / tire desaturate · walk & fly speed · FOV · floor & edge-wall visibility · dirt tile size · debug flat-shade / wireframe.

Plus buttons for **Return home**, **Back to setup**, **Export nearby as .glb**, and the **post-processing** shader pad.

---

## Project layout

```
assets/
  tex/                 POM tile sets, rust/tire biome sets, dirt floor
  models/              jy_parts (tiles), jy_structures_library, jy_wall
scripts/
  discover-glb.mjs     zero-dep GLB inspector (bbox / orientation / naming)
src/
  config.js            single source of truth for all tunables (drives both UIs)
  seed.js              cyrb128 + mulberry32 seeded PRNG
  settings.js          localStorage persistence (world + post-FX)
  gen/
    noise.js           simplex, fBm, Worley/cellular
    heightField.js     global height + biome fields (pure fn of world XZ)
    chunk.js           corner terrain model + biome texture families + structures
    chunkManager.js    streaming: generate / dispose, time-sliced budget
    placeStructures.js deterministic claimed-grid structure placement
  three/
    scene.js           renderer / camera / lights / loop
    flyCamera.js       walk + fly controls, +X boundary clamp
    textures.js        POM texture-set loading
    pomMaterial.js     parallax-occlusion patch of MeshStandardMaterial
    tiles.js           tile GLB → geometry registry
    structures.js      structure library loader (bake + re-zero)
    floor.js           pseudo-infinite scrolling dirt
    wallEdge.js        pseudo-infinite western boundary wall
    postfx.js          fullscreen shader pass (colour + depth)
    demo.js            orchestration: wires it all together
    catalog.js         tile catalog debug view
  ui/
    startScreen.js     seed + world-gen form
    sidebar.js         Tweakpane runtime controls + shader pad
    hud.js             on-screen stats / biome readout
  main.js              entry point (setup ⇄ running)
```

---

## Tech stack

- **[Three.js](https://threejs.org/)** r0.185 — WebGL2 rendering, `GLTFLoader`, `GLTFExporter`
- **[Vite](https://vitejs.dev/)** 8 — dev server + static build (`base: './'` for GitHub Pages / any subpath)
- **[Tweakpane](https://tweakpane.github.io/docs/)** 4 — runtime settings sidebar
- Vanilla JS + hand-rolled HTML/CSS for the start screen — no framework

---

## Deploying

`npm run build` emits a fully static `dist/` (HTML/JS/fingerprinted assets) — no server needed. Because `vite.config.js` sets `base: './'`, it works from any subpath: GitHub Pages project sites, a nested static-host folder, even a `file://` preview. Note the assets are chunky (a ~9 MB tile GLB and tens of MB of textures), which is fine for personal/small-group use; the Unity port will bring its own compressed textures.

---

## Notes

This is a **research POC**, not the game. When the generation and look are dialled in, the strategy ports to Unity — where meshing, texture compression, collision, and, of course, the actual jiggle-physics bumper cars get built for real.

*Built as a look-dev + generation sandbox for **Dumper Cars**.*
