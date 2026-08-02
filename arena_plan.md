# Dumper Cars — Arena Generator POC — Plan

> Status: **Phase 4 LOCKED — Phase 5 in progress.** §4 verified against the
> re-exported `arena_parts.glb`. Generation approach locked: **ramps-first, grow
> islands, domino-tiled level 3.** Signed off; dev underway.

---

## 1. Purpose

Second POC in the Dumper Cars repo (sibling to the junkyard), entirely under
`src/arena/`. Procedurally + **deterministically** (seed-driven) generates a
**static** bumper-car battle arena from modular 4 m blocks.

- POC only: no driving/collision. Walk + fly movement (same as junkyard).
- Static once generated — no chunking/streaming.
- Same seed → identical arena (salted RNG streams per subsystem).
- Scale intent: arena size scales with player count (game); never below a size
  that comfortably fits all three levels.

---

## 2. Coordinate & grid conventions  (verified P2)

- Y up, metric. Grid: **4 m × 4 m cells** on X/Z.
- **+X = east, −Z = north, +Z = south, +Y = up** (Blender Z-up→Y-up imported
  correctly). Cell (cx,cz): X∈[cx·4,cx·4+4], Z∈[cz·4,cz·4+4]; center
  (cx·4+2,·,cz·4+2); north edge cz·4, south cz·4+4, west cx·4, east cx·4+4.
- **Levels** (2 m each): L1 top Y=0; L2 top Y=2; L3 top Y=4.
- **Bounds:** "size" = the in-bounds/playable rectangle. Assets spill OOB by
  design; player + fly camera are **hard-clamped in-bounds**.

---

## 3. Arena sizing & density (all dialable on the start screen)

- `arenaSizeMeters` = **diagonal (m)**.
- `aspectMin` / `aspectMax` = aspect-ratio bounds (default e.g. 0.5…2.0); roll a
  random ratio in range → width×depth from (diagonal, ratio) → **quantize to 4 m
  cells** = in-bounds W×D.
- `level2CoverageMin/Max`, `level3CoverageMin/Max` = fraction of in-bounds area
  raised to that level (random per generation). Each level also rolls a random
  **per-island size ratio** so island counts/sizes vary.
- `minRampsPerIsland` (default 1).
- **Minimum viability:** default base size must fit all 3 levels (L3 may be a
  single container/bridge). If a level can't be placed, **drop it gracefully +
  toast a warning** (no infinite retry). Greg tunes the practical minimum from
  warnings.

---

## 4. Asset catalog — VERIFIED (P2, `scripts/arena_discover.mjs`)

Root `ArenaParts` (empty) + 16 mesh children; all have UVs + material. Sizes (X,Y,Z) m.

| Asset | Size | Cells | Pivot | Notes |
|---|---|---|---|---|
| `Arena_ShippingContainer_{Blue,Red,White,Green}` | 8×4×4 | 2×1 (long X) | bottom-center (of 8×4 = **edge between its 2 cells**) | Wall / L3 platform. **Same mesh, differ by albedo only** → render as ONE instanced mesh w/ per-instance color select (see §7). Domino. |
| `Arena_Bridge` | 8×4×4 | 2×1 | bottom-center | Own mesh (open underside + pillars). Drive under & over; in-bounds only; domino. |
| `Arena_HalfPlatform` | 4×2×4 | 1×1 | bottom-center | L2 filler; top drivable Y=2. Only a ramp may sit on top. |
| `Arena_Ramp` | 4×2×4 | 1×1 | bottom-center (y≈0) | Wedge **low=south(+Z,Y0) → high=north(−Z,Y2)** (Blender −Y low / +Y high, confirmed). Rotate about center. Only piece allowed above Y=0 (on a half-platform → 2→3 ramp). |
| `Arena_Ramp_Corner` | 4×2×4 | 1×1 | bottom-center | Corner wedge, NW high. Parked until basic ramps work. |
| `Arena_Metal_Barrier` | 4×1.1×0.19 | edge | **cell-center**, wall on **north edge** (fixed re-export) | Rotates about cell center like tiles. **L3 only** (§5.3). |
| `Arena_Bench` | 1.97×1.25×0.64 | deco | bottom-center | Seating; south-facing (+Z) default. |
| `Arena_FoldingChair` / `LawnChair` / `PlasticChair` | ~0.7×1.1×0.8 | deco | bottom-center | Seating; south-facing default. |
| `Arena_TireBarrier_Straight_East` | 1×0.33×4 | in-cell | **cell-center** | Straight run, default **east** edge (spans Z). Rotate 90° steps. |
| `Arena_TireBarrier_InnerCorner_NorthEast` | ~1×0.33×1 | in-cell | **cell-center** | **Two adjacent solid edges** (concave), default N+E corner. Rotate. |
| `Arena_TireBarrier_OuterCorner_NorthEast` | ~4×0.33×4 | in-cell | **cell-center** | **Kitty-corner** (diagonal solid, both orthogonals open), default NE. Rotate. *(confirm mesh↔rule visually P7.)* |

Placement is uniform: rotate about pivot, translate. Containers/bridges anchor to
the **midpoint of their two cells** (handled in code — no re-export needed).

---

## 5. Generation — LOCKED approach: ramps-first, grow islands

Per-cell layered state over a padded grid: `bounds` (in/out), `level` (0/2/4),
`type` (empty/ground/halfplatform/container/bridge/ramp+dir/rampcorner+dir),
`orientation`, plus reservations (ramp clearances). Output = placement list →
InstancedMeshes.

**Why ramps-first + domino growth:** it turns the two hardest requirements into
*construction invariants* instead of validators:
- **Hole-free** islands: grow via BFS that never encloses a lower cell (validated
  per add by a cheap flood-fill of the lower region — arenas are small/static).
- **Domino-tileable L3**: grow L3 islands by appending **whole containers
  (dominoes)**, so the island is a union of dominoes = tileable by construction.
- **Reachability**: islands are seeded at ramp landings, so every island has ≥1
  ramp by construction.

### 5.1 Pipeline (locked order)

1. **Size** → aspect ratio → rectangle → quantize (in-bounds W×D).
2. **Outer rings** (walls): fill the 2-cell-wide ring band around in-bounds with
   containers at Y=0 (domino-fill a 2-wide loop; always tileable), random H/V, no
   ground gaps. **Clip some containers inward** (break the rectangle) and allow
   spill outward. Then a **second story** at Y=4 within the ring band (domino
   subset, gaps allowed, rotatable). Mark ring/OOB solid (height ≥4).
3. **L2 ramps + islands:** place `N2` **1→2 ramp-runs** (3 cells: L1 lower-lead +
   ramp + L2 landing) at valid empty in-bounds spots; reserve clearances. **Grow
   an L2 island** (half-platforms, 1×1 cells) from each landing by non-enclosing
   BFS up to the rolled size, never violating a reservation. Islands may merge.
4. **L3 ramps + islands:** place `N3` **2→3 ramp-runs** (L2 lower-lead + ramp on a
   half-platform + L3 landing) anchored on existing L2 islands. **Grow L3 islands
   by appending containers (dominoes)** from each landing, hole-free + not
   violating reservations.
5. **Bridges pass:** convert eligible L3 containers to bridges where the container
   has L1 ground on **both long sides** and the underpass is useful (through-lane
   or drivable S-curve; not a bridge-to-nowhere). Bridge = **L3 above AND L1
   below** for neighbor logic; double bridges allowed; bridge pillars land at the
   ends (tires needed around them, §5.2 / image 6).
6. **Metal barriers:** on **L3 cells whose edge faces the bounds** (§5.3).
7. **Tires pass** (§5.2).
8. **Chairs:** on outer-ring container tops only, **both stories**, sky-open,
   facing inward, ±15° jitter.
9. **Instantiate** InstancedMeshes.

### 5.2 Tire barriers (L1 autotiling)

Per **ground cell**, against a "solid/high" mask where **walls, L2, L3, bridges =
solid** but **ramps = open (L0)** (never block ramp access):

- **InnerCorner** — two adjacent orthogonal edges solid (concave); default N+E.
- **Straight** — each solid orthogonal edge **that is NOT already consumed by an
  InnerCorner**. Precedence: if two adjacent edges are solid, the InnerCorner
  covers both and **suppresses** the straights on those two edges (no doubling).
- **OuterCorner** — diagonal neighbor solid AND both shared orthogonals open
  (kitty-corner only), default NE.
- Multiple pieces per cell allowed and common (images 7ca266f6 & 8: e.g. an inner
  corner + a straight on the far edge + an outer corner = 3 pieces in one cell).
- **No 1×1 dead-ends** (image 2): no tile closes 3 walls. Pass detects 1-wide
  dead-end pockets → fix (open a side / fill). 1-wide through-corridors OK.
- Bridge underpass cells + pillar bases get tires (bridge counts as L1 here).

### 5.3 Metal barriers — L3 only

OOB is all containers (≥Y=4 walls), so you can't leave from L1/L2. Only risk is an
L3 island touching the bounds looking continuous with the Y=4 grandstand tops → a
metal barrier on L3 bounds-facing edges signals "no entry."

### 5.4 Later (out of scope P5–P7)

Post-gen **environmental pass**: jumps (dedicated model), tire piles, tesla coils,
kill-saws, recessed spikes, etc. **Jumps are deferred** — ramps here always
connect two levels.

---

## 6. Module layout (under `src/arena/`)

- `gen/grid.js` — domain, coords, bounds, neighbors, reservations.
- `gen/rng.js` — (or reuse `seed.js`) salted streams per subsystem.
- `gen/rings.js` — outer-ring domino fill (both stories).
- `gen/islands.js` — ramp-run placement + island growth (L2 per-cell, L3 dominoes),
  hole-free BFS, clearance reservations.
- `gen/bridges.js` — L3 container→bridge promotion.
- `gen/tires.js` — tire autotiling + dead-end pass.
- `gen/barriers.js` — L3 bounds metal barriers.
- `gen/arena.js` — orchestrates the pipeline → grid + placement list.
- `three/library.js` — load `arena_parts.glb`, split `ArenaParts` children into a
  name→geometry/material registry (re-zero to pivots); container = shared mesh +
  albedo-array material.
- `three/build.js` — placements → InstancedMeshes (incl. per-instance container color).
- `ui/overlay.js` — **debug top-down overlay** (Tweakpane toggle): cells by level,
  ramps/bridges/tires/barriers markers. Build early (P5).
- Reuse: `three/scene.js`, `three/flyCamera.js` (+ hard bounds clamp),
  `three/floor.js`, `three/postfx.js`, `ui/*`, `config.js` (+ new params).

---

## 7. Rendering notes (P2 decisions)

- **Containers = one shared mesh, 4 colors via material only.** Render as a single
  InstancedMesh; select albedo per-instance with an `aColor`/`aTexLayer` attribute
  + `onBeforeCompile` swapping the base-map sampler for a `sampler2DArray` of the 4
  albedos (same technique family as the junkyard POM patch). Non-albedo maps shared.
- **Bridge** is its own mesh (open underside/pillars).
- Container/bridge pivot kept at the 2-cell edge midpoint; the generator emits
  dominoes as (cell, direction) and `build.js` computes transform = midpoint of the
  two cell centers + rotationY. No Blender re-export needed.
- One InstancedMesh per remaining unique mesh (halfplatform, ramp, ramp_corner,
  metal_barrier, 3 tires, 4 chairs).

---

## 8. Resolved decisions

- Ramps-first + domino growth **locked**.
- Density: dialable L2/L3 min/max + random per-island ratios; `minRampsPerIsland`.
- Chairs: outer-ring containers only, both stories, facing in.
- Metal barriers: L3 only.
- Jumps: scrapped from ramps (later environmental pass).
- Metal-barrier pivot fixed to cell-center (re-export verified).
- Containers: single mesh + per-instance albedo array; pivot handled in code.
- Ramp slope: low=south / high=north (confirmed from Blender −Y/+Y).

**Still to verify (non-blocking):** corner mesh↔rule mapping visually in P7;
ramp slope render check in P5; player-bounds clamp behavior on overhanging
in-bounds container tops (decide in P5).

**P5 fixes (post-review):**
- Inward pokes are validated to never create a 1×1 dead-end (rings.js rejects a
  poke that would wall a ground cell on 3 sides). The tire dead-end pass (P7)
  still handles island-induced dead-ends.
- library.js keeps the GLB's authored normals (only synthesizes if missing) —
  recomputing flattened/streaked curved parts (chairs).
- Chairs enforce ≥1 m spacing on a top (retry ≤10×, else skip) — no overlaps.

**P6 design note — inward pokes are pre-existing level 3:** a poked-in container
is a 4 m wall, so its TOP (Y=4) is already a drivable level-3 surface inside the
bounds. Island generation must (a) treat poke-top cells as existing L3 the
islands can merge with, (b) put metal barriers on their bounds-facing edges, and
(c) NOT require them to have their own ramp — if an island doesn't reach them
they simply remain part of the map's shape (unreachable is fine for these,
unlike generated islands).

---

## 9. Phase roadmap

- **P1** digest + doc ✅
- **P2** discovery (`arena_discover.mjs`), §4 verified ✅ (re-verified after re-export)
- **P3** logic locked: ramps-first, domino L3, tire autotiling, densities ✅
- **P4** lock the plan — this doc ✅ (signed off)
- **P5** dev: arena shape + outer rings + chairs + debug overlay ✅
- **P6** dev: inner levels ✅
  - Step 1 — L2 islands + 1→2 ramps ✅
  - Step 2a — L3 islands + 2→3 ramps + metal barriers ✅
  - Step 2b — bridges pass (`gen/bridges.js`): L3 dominoes with a through-lane
    beneath (drivable ground on both long sides) promoted to `Arena_Bridge`
    (drive over + under); dead-end-safe; double bridges via fixed-point iteration.
    Tunnel runs across the domino's long sides (pillars at the short ends);
    `bridgeChance` param. Bridge cells stay L3 tops for the walk sampler ✅
- **P7** dev: tires + dead-end pass ← next
