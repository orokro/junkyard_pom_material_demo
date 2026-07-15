/**
 * ============================================================================
 * ui/hud.js
 * ----------------------------------------------------------------------------
 * Minimal heads-up display: shows the active seed and a short hint line.
 * Kept intentionally tiny; later phases can extend it with position / chunk
 * counters.
 * ============================================================================
 */

/**
 * Render the HUD contents.
 * @param {HTMLElement} host HUD container (#hud).
 * @param {string} seed Active seed.
 * @param {string} [hint] Optional hint line.
 * @returns {void}
 */
export function renderHud(host, seed, hint = "WASD + Shift + mouse (coming next phase)") {
	host.innerHTML = "";

	const seedLine = document.createElement("div");
	seedLine.className = "hud__seed";
	seedLine.textContent = `seed: ${seed}`;

	const hintLine = document.createElement("div");
	hintLine.className = "hud__hint";
	hintLine.textContent = hint;

	host.appendChild(seedLine);
	host.appendChild(hintLine);
}
