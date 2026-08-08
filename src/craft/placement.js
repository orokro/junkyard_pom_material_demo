/**
 * ============================================================================
 * craft/placement.js
 * ----------------------------------------------------------------------------
 * Shared, mutable tuning for how craftable parts assemble + sit on the car.
 * The library reads these when baking; the debug panel writes them and asks the
 * car view to re-bake. Kept in one place so ghost, committed placements, and
 * inventory thumbnails all stay in sync.
 * ============================================================================
 */

/** Per-family uniform scale (base + attached hand together). Debug-tunable. */
export const PLACE = { pipe: 0.75, spring: 0.75, ram: 0.75 };

/** Which scale family each base belongs to (others scale 1:1). */
export const FAMILY = { short_pipe: "pipe", long_pipe: "pipe", spring: "spring", hyd_piston: "ram" };

/** Target max-dimension for a unified hand, in base-local units (before family scale). */
export const HAND = { target: 0.62 };

/** @param {string} baseId @returns {number} family scale for a base id */
export function familyScale(baseId) { const f = FAMILY[baseId]; return f ? (PLACE[f] ?? 1) : 1; }

/** subscribers notified when a slider changes, so the 3D can re-bake */
const subs = new Set();
export function onPlaceChange(fn) { subs.add(fn); return () => subs.delete(fn); }
export function firePlaceChange() { for (const fn of subs) try { fn(); } catch (e) { console.error(e); } }
