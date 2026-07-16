/**
 * ============================================================================
 * ui/hud.js
 * ----------------------------------------------------------------------------
 * Minimal heads-up display: active seed, a controls hint, and a live stats line
 * (updated each frame with chunk count + position).
 * ============================================================================
 */

/**
 * Render the HUD contents.
 * @param {HTMLElement} host HUD container (#hud).
 * @param {string} seed Active seed.
 * @param {string} [hint] Optional controls hint line.
 * @returns {void}
 */
export function renderHud(host, seed, hint = "WASD + Shift + mouse") {
	host.innerHTML = "";

	const seedLine = document.createElement("div");
	seedLine.className = "hud__seed";
	seedLine.textContent = `seed: ${seed}`;

	const hintLine = document.createElement("div");
	hintLine.className = "hud__hint";
	hintLine.textContent = hint;

	const statsLine = document.createElement("div");
	statsLine.className = "hud__stats";
	statsLine.id = "hud-stats";

	host.appendChild(seedLine);
	host.appendChild(hintLine);
	host.appendChild(statsLine);
}

/**
 * Update the live stats line.
 * @param {string} text Stats text.
 * @returns {void}
 */
export function updateHudStats(text) {
	const el = document.getElementById("hud-stats");
	if (el) el.textContent = text;
}
