/**
 * ============================================================================
 * craft/scale.js
 * ----------------------------------------------------------------------------
 * REM base-font scaling engine (locked approach). Everything in the UI is sized
 * in `rem`; this drives :root font-size so the design scales at constant aspect
 * ratio and reflows (via flex/grid) when the aspect ratio changes.
 *
 * base-font(px) = clamp( min( heightPerRem, widthPerRem ), MIN, MAX )
 *   heightPerRem = vh * BASIS_REM / BASIS_H         // whole design fits vertically
 *   widthPerRem  = (vw * 0.5) / COLUMN_MIN_REM      // each 50% column fits its
 *                                                   //   non-compressible panel
 * The width term guarantees the SLOTS + CRAFTING panels never clip; leftover
 * width then reflows into 3D width / slot gaps / inventory columns.
 * ============================================================================
 */

const BASIS_H = 1180;   // mockup height (1080 + bottom bar)
const BASIS_REM = 16;   // px/rem at the basis resolution
/** Non-compressible width (rem) a single 50% column must fit (slots is widest). */
export const COLUMN_MIN_REM = 47;
const MIN_PX = 3, MAX_PX = 24;

let override = null; // debug override (px) or null for auto

/** Recompute and apply the root font-size. @returns {number} px used. */
export function applyScale() {
	const vw = window.innerWidth, vh = window.innerHeight;
	let px;
	if (override != null) {
		px = override;
	} else {
		const heightPerRem = (vh * BASIS_REM) / BASIS_H;
		const widthPerRem = (vw * 0.5) / COLUMN_MIN_REM;
		px = Math.max(MIN_PX, Math.min(heightPerRem, widthPerRem, MAX_PX));
	}
	document.documentElement.style.fontSize = px.toFixed(3) + "px";
	document.documentElement.style.setProperty("--basefont", px.toFixed(3));
	return px;
}

/** Install the resize listener. @param {(px:number)=>void} [onApply] */
export function installScale(onApply) {
	const run = () => { const px = applyScale(); onApply?.(px); };
	window.addEventListener("resize", run);
	run();
	return run;
}

/** Debug: force a base font (px) or pass null to return to auto. */
export function setScaleOverride(px) { override = px; applyScale(); }
