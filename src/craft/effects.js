/**
 * ============================================================================
 * craft/effects.js
 * ----------------------------------------------------------------------------
 * Procedural (no-rig) weapon effects, driven by carview's tick. Key-fires route
 * here for the whole-car JUMP and the particle bursts (EMP rings, magnet pull,
 * jet exhaust, launcher projectile). Each effect pushes a small updater onto an
 * active list; the updater returns false when done and is disposed.
 *
 * Jump bias (per Greg): shocks push their corner up, so the car tilts by fitting
 * the tilt to which of the 4 suspension corners are filled — 4 = level + a little
 * random; 2 front/rear = pitch; kitty-corner = pitch+roll twist; 3 = dips toward
 * the missing corner. Wheels droop while airborne.
 * ============================================================================
 */

import * as THREE from "three";

const rand = (a, b) => a + Math.random() * (b - a);

export function makeEffects({ scene, carRoot }) {
	const active = [];
	let jumping = false;
	const push = (fx) => active.push(fx);
	function update(dt) {
		for (let i = active.length - 1; i >= 0; i--) {
			if (!active[i].update(dt)) { active[i].dispose && active[i].dispose(); active.splice(i, 1); }
		}
	}

	// ---------- JUMP ----------
	const JUMP = { crouch: 0.07, rise: 0.24, fall: 0.30, land: 0.10, height: 0.55, dip: 0.05, squash: 0.06, wheelDrop: 0.22 };
	const PITCH_MAX = 0.5, ROLL_MAX = 0.5, RAND_TILT = 0.05;
	const clampAbs = (v, m) => Math.max(-m, Math.min(m, v));
	/** @param {Array} susp 4 suspension slots [FL,FR,RL,RR]; truthy = shock present */
	function jump(susp) {
		if (jumping) return false;
		susp = susp || [];
		const FL = susp[0] ? 1 : 0, FR = susp[1] ? 1 : 0, RL = susp[2] ? 1 : 0, RR = susp[3] ? 1 : 0;
		const n = FL + FR + RL + RR;
		if (n === 0) return false;
		let pitch = (FL + FR) - (RL + RR);       // front-heavy lift -> nose up
		let roll = (FR + RR) - (FL + RL);        // right-heavy lift -> right up
		const twist = (FL + RR) - (FR + RL);     // diagonal -> coordinated pitch+roll for fun
		pitch += twist * 0.6; roll -= twist * 0.6;
		// normalise, cap the drama at one full axis (keeps a lone shock from launching a corner ~46°), add a little jitter
		pitch = clampAbs((pitch / Math.max(1, n)) * PITCH_MAX, PITCH_MAX) + rand(-RAND_TILT, RAND_TILT);
		roll = clampAbs((roll / Math.max(1, n)) * ROLL_MAX, ROLL_MAX) + rand(-RAND_TILT, RAND_TILT);

		const restY = carRoot.position.y, restRX = carRoot.rotation.x, restRZ = carRoot.rotation.z;
		const wheels = [];
		carRoot.traverse((o) => { if (o.userData && (o.userData.wheel || o.userData.wheelDrop)) wheels.push({ o, y: o.position.y }); });

		jumping = true;
		let t = 0; const T = JUMP;
		const t1 = T.crouch, t2 = t1 + T.rise, t3 = t2 + T.fall, t4 = t3 + T.land;
		push({
			update: (dt) => {
				t += dt;
				let y, env;
				if (t < t1) { y = -T.dip * Math.sin((t / t1) * Math.PI / 2); env = 0; }
				else if (t < t2) { const p = (t - t1) / T.rise; y = -T.dip + (T.height + T.dip) * (1 - Math.pow(1 - p, 2)); env = Math.min(1, y / T.height); }
				else if (t < t3) { const p = (t - t2) / T.fall; y = T.height * (1 - p * p); env = Math.max(0, y / T.height); }
				else if (t < t4) { y = -T.squash * Math.sin(((t - t3) / T.land) * Math.PI); env = 0; }
				else {
					carRoot.position.y = restY; carRoot.rotation.x = restRX; carRoot.rotation.z = restRZ;
					wheels.forEach((w) => (w.o.position.y = w.y)); jumping = false; return false;
				}
				carRoot.position.y = restY + y;
				carRoot.rotation.x = restRX + pitch * env;
				carRoot.rotation.z = restRZ + roll * env;
				wheels.forEach((w) => (w.o.position.y = w.y - T.wheelDrop * env));
				return true;
			},
		});
		return true;
	}

	// ---------- particle helpers ----------
	function makePoints(count, color, size) {
		const g = new THREE.BufferGeometry();
		const pos = new Float32Array(count * 3); g.setAttribute("position", new THREE.BufferAttribute(pos, 3));
		const m = new THREE.PointsMaterial({ color, size, transparent: true, opacity: 1, depthWrite: false });
		const pts = new THREE.Points(g, m); scene.add(pts);
		return { pts, pos, m, g };
	}

	/** EMP: expanding electric rings from the gun */
	function emp(worldPos) {
		for (let k = 0; k < 2; k++) {
			const ring = new THREE.Mesh(new THREE.TorusGeometry(0.3, 0.05, 8, 40),
				new THREE.MeshBasicMaterial({ color: 0x66ccff, transparent: true, opacity: 0.9, depthWrite: false }));
			ring.position.copy(worldPos); ring.rotation.x = Math.PI / 2; scene.add(ring);
			let t = -k * 0.12;
			push({
				update: (dt) => { t += dt; if (t < 0) return true; const p = t / 0.5; if (p >= 1) return false; const s = 0.3 + p * 3.2; ring.scale.set(s, s, 1); ring.material.opacity = 0.9 * (1 - p); return true; },
				dispose: () => { scene.remove(ring); ring.geometry.dispose(); ring.material.dispose(); },
			});
		}
		return true;
	}

	/** Electromagnet: motes drawn inward to the magnet */
	function magnet(worldPos) {
		const N = 48, { pts, pos, m, g } = makePoints(N, 0xb060ff, 0.12), start = [];
		for (let i = 0; i < N; i++) {
			const th = rand(0, Math.PI * 2), ph = rand(0, Math.PI), r = rand(1.5, 2.4);
			const v = new THREE.Vector3(Math.sin(ph) * Math.cos(th), Math.cos(ph) * 0.7, Math.sin(ph) * Math.sin(th)).multiplyScalar(r);
			start.push(v); pos[i * 3] = worldPos.x + v.x; pos[i * 3 + 1] = worldPos.y + v.y; pos[i * 3 + 2] = worldPos.z + v.z;
		}
		g.attributes.position.needsUpdate = true; let t = 0;
		push({
			update: (dt) => { t += dt; const p = t / 0.55; if (p >= 1) return false; const f = 1 - p; for (let i = 0; i < N; i++) { pos[i * 3] = worldPos.x + start[i].x * f; pos[i * 3 + 1] = worldPos.y + start[i].y * f; pos[i * 3 + 2] = worldPos.z + start[i].z * f; } g.attributes.position.needsUpdate = true; m.opacity = 1 - p * 0.7; return true; },
			dispose: () => { scene.remove(pts); g.dispose(); m.dispose(); },
		});
		return true;
	}

	/** Jet: fiery exhaust burst out the rear */
	function jet(worldPos, dir) {
		const N = 40, { pts, pos, m, g } = makePoints(N, 0xffaa33, 0.14), vel = [], d = dir.clone().normalize();
		for (let i = 0; i < N; i++) { vel.push(d.clone().multiplyScalar(rand(2, 4)).add(new THREE.Vector3(rand(-0.3, 0.3), rand(-0.3, 0.3), rand(-0.3, 0.3)))); pos[i * 3] = worldPos.x; pos[i * 3 + 1] = worldPos.y; pos[i * 3 + 2] = worldPos.z; }
		g.attributes.position.needsUpdate = true; let t = 0;
		push({
			update: (dt) => { t += dt; const p = t / 0.4; if (p >= 1) return false; for (let i = 0; i < N; i++) { pos[i * 3] += vel[i].x * dt; pos[i * 3 + 1] += vel[i].y * dt; pos[i * 3 + 2] += vel[i].z * dt; } g.attributes.position.needsUpdate = true; m.opacity = 1 - p; m.color.setHSL(0.08 * (1 - p), 1, 0.5); return true; },
			dispose: () => { scene.remove(pts); g.dispose(); m.dispose(); },
		});
		return true;
	}

	/** Launcher: a projectile flung along the aim */
	function launcher(worldPos, dir) {
		const proj = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 0.4, 8),
			new THREE.MeshStandardMaterial({ color: 0x9aa0a6, metalness: 0.6, roughness: 0.4 }));
		const d = dir.clone().normalize();
		proj.position.copy(worldPos); proj.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), d); scene.add(proj);
		let t = 0;
		push({
			update: (dt) => { t += dt; if (t > 0.7) return false; proj.position.addScaledVector(d, 7 * dt); return true; },
			dispose: () => { scene.remove(proj); proj.geometry.dispose(); proj.material.dispose(); },
		});
		return true;
	}

	return { jump, emp, magnet, jet, launcher, update, isJumping: () => jumping };
}
