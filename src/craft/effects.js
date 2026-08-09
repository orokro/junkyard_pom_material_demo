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

	// Jump rotation pivot = the WHEEL CENTROID in carRoot-local space: the true
	// footprint centre horizontally and axle height vertically. A jumping car is
	// airborne on all four wheels, so it should rotate about that low centre-of-mass,
	// not carRoot's origin (front/floor) nor the body bbox centre (which a tall
	// antenna drags way up above the car). Captured now, before any weapons attach.
	carRoot.updateWorldMatrix(true, true);
	const pivotLocal = (() => {
		const _wc = new THREE.Vector3(), mn = new THREE.Vector3(Infinity, Infinity, Infinity), mx = new THREE.Vector3(-Infinity, -Infinity, -Infinity);
		let found = 0;
		carRoot.traverse((o) => {
			if (!o.isMesh || typeof o.userData.wheel !== "string" || !o.geometry) return;
			o.updateWorldMatrix(true, false); o.geometry.computeBoundingBox();
			o.geometry.boundingBox.getCenter(_wc).applyMatrix4(o.matrixWorld);   // this wheel's world centre
			mn.min(_wc); mx.max(_wc); found++;
		});
		const world = found ? mn.add(mx).multiplyScalar(0.5) : new THREE.Box3().setFromObject(carRoot).getCenter(new THREE.Vector3());
		return carRoot.worldToLocal(world);
	})();
	const _pvNow = new THREE.Vector3(), _tmp = new THREE.Vector3();

	// ---------- DEBUG jump-profile viz ----------
	// Corner markers + a panto-free bounding box (both ride the car), plus persistent
	// world-space trails of the four TOP corners painted during a jump (cleared on the
	// next jump). Lets us literally see the jump profile and spot any asymmetry.
	const DBG = { FL: 0xff5566, FR: 0x55dd66, RL: 0x4499ff, RR: 0xffbb33 };
	const PANTO_MAXY = 1.3;          // meshes taller than this (the right-only pantograph) are ignored
	let debugOn = true;
	const bodyMin = new THREE.Vector3(Infinity, Infinity, Infinity), bodyMax = new THREE.Vector3(-Infinity, -Infinity, -Infinity);
	carRoot.traverse((o) => {
		if (!o.isMesh || !o.geometry) return;
		o.updateWorldMatrix(true, false); o.geometry.computeBoundingBox();
		const b = o.geometry.boundingBox; if (!b) return;
		const mm = new THREE.Vector3(Infinity, Infinity, Infinity), mx2 = new THREE.Vector3(-Infinity, -Infinity, -Infinity);
		for (let xi = 0; xi < 2; xi++) for (let yi = 0; yi < 2; yi++) for (let zi = 0; zi < 2; zi++) {
			carRoot.worldToLocal(_tmp.set(xi ? b.max.x : b.min.x, yi ? b.max.y : b.min.y, zi ? b.max.z : b.min.z).applyMatrix4(o.matrixWorld));
			mm.min(_tmp); mx2.max(_tmp);
		}
		if (mx2.y > PANTO_MAXY) return;   // skip the pantograph
		bodyMin.min(mm); bodyMax.max(mx2);
	});
	// front = smaller z, left = smaller x; the four TOP corners in carRoot-local
	const cornersLocal = {
		FL: new THREE.Vector3(bodyMin.x, bodyMax.y, bodyMin.z), FR: new THREE.Vector3(bodyMax.x, bodyMax.y, bodyMin.z),
		RL: new THREE.Vector3(bodyMin.x, bodyMax.y, bodyMax.z), RR: new THREE.Vector3(bodyMax.x, bodyMax.y, bodyMax.z),
	};
	const dbgGroup = new THREE.Group(); carRoot.add(dbgGroup);
	dbgGroup.add(new THREE.Box3Helper(new THREE.Box3(bodyMin.clone(), bodyMax.clone()), 0xffffff));
	const markerGeo = new THREE.SphereGeometry(0.05, 12, 12);
	for (const k of ["FL", "FR", "RL", "RR"]) {
		const m = new THREE.Mesh(markerGeo, new THREE.MeshBasicMaterial({ color: DBG[k] }));
		m.position.copy(cornersLocal[k]); dbgGroup.add(m);
	}
	const trailGroup = new THREE.Group(); scene.add(trailGroup);
	const TRAIL_CAP = 300, trails = {};
	for (const k of ["FL", "FR", "RL", "RR"]) {
		const g = new THREE.BufferGeometry(); const pos = new Float32Array(TRAIL_CAP * 3);
		g.setAttribute("position", new THREE.BufferAttribute(pos, 3)); g.setDrawRange(0, 0);
		const line = new THREE.Line(g, new THREE.LineBasicMaterial({ color: DBG[k] })); line.frustumCulled = false;
		trailGroup.add(line); trails[k] = { g, pos, n: 0 };
	}
	function clearTrails() { for (const k in trails) { trails[k].n = 0; trails[k].g.setDrawRange(0, 0); } }
	function recordTrails() {
		for (const k in trails) {
			const tr = trails[k]; if (tr.n >= TRAIL_CAP) continue;
			carRoot.localToWorld(_tmp.copy(cornersLocal[k]));
			tr.pos[tr.n * 3] = _tmp.x; tr.pos[tr.n * 3 + 1] = _tmp.y; tr.pos[tr.n * 3 + 2] = _tmp.z;
			tr.n++; tr.g.setDrawRange(0, tr.n); tr.g.attributes.position.needsUpdate = true; tr.g.boundingSphere = null;
		}
	}
	function setDebug(on) { debugOn = on; dbgGroup.visible = on; trailGroup.visible = on; }
	setDebug(true);
	function update(dt) {
		for (let i = active.length - 1; i >= 0; i--) {
			if (!active[i].update(dt)) { active[i].dispose && active[i].dispose(); active.splice(i, 1); }
		}
	}

	// ---------- JUMP ----------
	const JUMP = { crouch: 0.07, rise: 0.24, fall: 0.30, land: 0.10, height: 0.55, dip: 0.05, squash: 0.06, wheelDrop: 0.22 };
	const PITCH_MAX = 0.5, ROLL_MAX = 0.5, RAND_TILT = 0.05, DIAG_ROCK = 1.2;
	const clampAbs = (v, m) => Math.max(-m, Math.min(m, v));
	/** @param {Array} susp 4 suspension slots [FL,FR,RL,RR]; truthy = shock present */
	function jump(susp) {
		if (jumping) return false;
		susp = susp || [];
		const has = [susp[0] ? 1 : 0, susp[1] ? 1 : 0, susp[2] ? 1 : 0, susp[3] ? 1 : 0];  // FL,FR,RL,RR
		const [FL, FR, RL, RR] = has;
		const n = FL + FR + RL + RR;
		if (n === 0) return false;
		// Plane fit: front-vs-rear -> pitch, right-vs-left -> roll. This is exactly mirror
		// symmetric (a left/right flip negates roll only; a front/back flip negates pitch
		// only), so singles, front/rear/left/right doubles and 3-of-4 all come out balanced.
		let pitch = (FL + FR) - (RL + RR);       // front-heavy lift -> nose up
		let roll = (FR + RR) - (FL + RL);        // right-heavy lift -> right up
		// A pure diagonal pair fits a flat plane (pitch=roll=0) -> would just pop level. For
		// fun, rock it about the axis through the two shocked tyres: += equal pitch & roll on
		// the FL-RR diagonal, opposite on FR-RL. Both keep the shocked tyres level and are
		// exact mirror images of each other (no front/back or left/right bias between them).
		const diagA = FL && RR && !FR && !RL, diagB = FR && RL && !FL && !RR;
		if (diagA || diagB) { pitch += DIAG_ROCK; roll += diagA ? DIAG_ROCK : -DIAG_ROCK; }
		// normalise, cap the drama at one full axis (keeps a lone shock from launching a corner ~46°), add a little jitter
		pitch = clampAbs((pitch / Math.max(1, n)) * PITCH_MAX, PITCH_MAX) + rand(-RAND_TILT, RAND_TILT);
		roll = clampAbs((roll / Math.max(1, n)) * ROLL_MAX, ROLL_MAX) + rand(-RAND_TILT, RAND_TILT);

		const restPos = carRoot.position.clone();
		const rx0 = carRoot.rotation.x, ry0 = carRoot.rotation.y, rz0 = carRoot.rotation.z, order = carRoot.rotation.order;
		const restRotPivot = pivotLocal.clone().applyEuler(carRoot.rotation);   // where the pivot sits at rest
		// only wheels whose corner actually has a shock droop
		const wheels = [];
		carRoot.traverse((o) => {
			const c = o.userData && o.userData.dropCorner;
			if (o.userData && (o.userData.wheel || o.userData.wheelDrop) && c != null && has[c]) wheels.push({ o, y: o.position.y });
		});

		jumping = true;
		if (debugOn) { clearTrails(); recordTrails(); }   // start the profile trails fresh at rest
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
					carRoot.position.copy(restPos); carRoot.rotation.set(rx0, ry0, rz0, order);
					wheels.forEach((w) => (w.o.position.y = w.y)); jumping = false;
					if (debugOn) recordTrails();
					return false;
				}
				// tilt about the car centre: rotate, then shift so the pivot stays put (+ the vertical hop)
				carRoot.rotation.set(rx0 + pitch * env, ry0, rz0 + roll * env, order);
				_pvNow.copy(pivotLocal).applyEuler(carRoot.rotation);
				carRoot.position.set(
					restPos.x + restRotPivot.x - _pvNow.x,
					restPos.y + restRotPivot.y - _pvNow.y + y,
					restPos.z + restRotPivot.z - _pvNow.z,
				);
				wheels.forEach((w) => (w.o.position.y = w.y - T.wheelDrop * env));
				if (debugOn) recordTrails();
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

	return { jump, emp, magnet, jet, launcher, update, isJumping: () => jumping, setDebug, clearTrails };
}
