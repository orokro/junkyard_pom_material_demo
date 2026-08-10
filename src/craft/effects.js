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
	setDebug(false);   // off by default; toggled from the debug window
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

	/** EMP: a forward-facing electric shockwave (only the front 180°) expanding out the gun */
	function emp(worldPos, dir) {
		const f = (dir && dir.lengthSq() > 1e-6) ? dir.clone().setY(0).normalize() : new THREE.Vector3(0, 0, -1);
		const up = new THREE.Vector3(0, 1, 0), right = new THREE.Vector3().crossVectors(f, up).normalize();
		const quat = new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().makeBasis(right, f, up)); // half-torus bulge (+Y local) -> forward
		const DUR = 0.85, R1 = 2.3;   // ~double the old reach, lasts longer
		for (let k = 0; k < 3; k++) {
			const ring = new THREE.Mesh(new THREE.TorusGeometry(1, 0.05, 8, 48, Math.PI),   // half ring (arc = π)
				new THREE.MeshBasicMaterial({ color: 0x66ccff, transparent: true, opacity: 0.9, depthWrite: false }));
			ring.position.copy(worldPos); ring.quaternion.copy(quat); ring.visible = false; scene.add(ring);   // hidden until its wave starts
			let t = -k * 0.15;
			push({
				update: (dt) => { t += dt; if (t < 0) return true; ring.visible = true; const p = t / DUR; if (p >= 1) return false; const s = 0.1 + p * R1; ring.scale.set(s, s, 1); ring.material.opacity = 0.9 * (1 - p * p); return true; },
				dispose: () => { scene.remove(ring); ring.geometry.dispose(); ring.material.dispose(); },
			});
		}
		return true;
	}

	/**
	 * Electromagnet: motes sucked inward. Particles spawn staggered over time (out of
	 * phase), ease inward on their own clocks, fade in/out, and drag short trails. The
	 * homing point is nudged toward the magnet's front (just behind the face), not its centre.
	 */
	function magnet(worldPos, dir) {
		const f = (dir && dir.lengthSq() > 1e-6) ? dir.clone().normalize() : new THREE.Vector3(0, 0, -1);
		const target = worldPos.clone().addScaledVector(f, 0.2);   // just behind the front face
		const N = 90, SPAWN_WIN = 0.6, TRAVEL = 0.6, K = 6, color = new THREE.Color(0xc070ff);
		const hg = new THREE.BufferGeometry(), hpos = new Float32Array(N * 3), hcol = new Float32Array(N * 3);
		hg.setAttribute("position", new THREE.BufferAttribute(hpos, 3)); hg.setAttribute("color", new THREE.BufferAttribute(hcol, 3));
		const hm = new THREE.PointsMaterial({ size: 0.13, vertexColors: true, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending });
		const heads = new THREE.Points(hg, hm); scene.add(heads);
		const segN = N * (K - 1);
		const tg = new THREE.BufferGeometry(), tpos = new Float32Array(segN * 6), tcol = new Float32Array(segN * 6);
		tg.setAttribute("position", new THREE.BufferAttribute(tpos, 3)); tg.setAttribute("color", new THREE.BufferAttribute(tcol, 3));
		const tm = new THREE.LineBasicMaterial({ vertexColors: true, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending });
		const trailLine = new THREE.LineSegments(tg, tm); trailLine.frustumCulled = false; scene.add(trailLine);
		const ease = (x) => (x < 0.5 ? 2 * x * x : 1 - Math.pow(-2 * x + 2, 2) / 2);
		const P = [], _u = new THREE.Vector3();
		for (let i = 0; i < N; i++) {
			// uniform point on the sphere, folded onto the FRONT hemisphere -> a north-pole dome ahead of the magnet
			const th = rand(0, Math.PI * 2), z = rand(-1, 1), s = Math.sqrt(Math.max(0, 1 - z * z));
			_u.set(s * Math.cos(th), z, s * Math.sin(th));
			const d = _u.dot(f); if (d < 0) _u.addScaledVector(f, -2 * d);   // reflect back rows into the front dome
			const start = target.clone().addScaledVector(_u, rand(1.4, 2.6));
			const hist = []; for (let k = 0; k < K; k++) hist.push(start.clone());
			P.push({ start, spawn: rand(0, SPAWN_WIN), travel: TRAVEL * rand(0.8, 1.25), hist, cur: start.clone() });
		}
		let t = 0;
		push({
			update: (dt) => {
				t += dt; let alive = false;
				for (let i = 0; i < N; i++) {
					const q = P[i], age = t - q.spawn; let bright = 0;
					if (age < 0) q.cur.copy(q.start);
					else if (age <= q.travel) { q.cur.copy(q.start).lerp(target, ease(age / q.travel)); bright = Math.sin((age / q.travel) * Math.PI); alive = true; }
					else q.cur.copy(target);
					q.hist.push(q.cur.clone()); if (q.hist.length > K) q.hist.shift();
					hpos[i * 3] = q.cur.x; hpos[i * 3 + 1] = q.cur.y; hpos[i * 3 + 2] = q.cur.z;
					hcol[i * 3] = color.r * bright; hcol[i * 3 + 1] = color.g * bright; hcol[i * 3 + 2] = color.b * bright;
					for (let k = 0; k < K - 1; k++) {
						const base = (i * (K - 1) + k) * 6, a = q.hist[k], b = q.hist[k + 1], tf = (k / (K - 1)) * bright * 0.6;
						tpos[base] = a.x; tpos[base + 1] = a.y; tpos[base + 2] = a.z; tpos[base + 3] = b.x; tpos[base + 4] = b.y; tpos[base + 5] = b.z;
						tcol[base] = color.r * tf; tcol[base + 1] = color.g * tf; tcol[base + 2] = color.b * tf;
						tcol[base + 3] = color.r * tf; tcol[base + 4] = color.g * tf; tcol[base + 5] = color.b * tf;
					}
				}
				hg.attributes.position.needsUpdate = true; hg.attributes.color.needsUpdate = true;
				tg.attributes.position.needsUpdate = true; tg.attributes.color.needsUpdate = true;
				return alive || t <= SPAWN_WIN;
			},
			dispose: () => { scene.remove(heads); scene.remove(trailLine); hg.dispose(); hm.dispose(); tg.dispose(); tm.dispose(); },
		});
		return true;
	}

	/** Jet: a rich, sustained fiery exhaust stream — particles emit over time and fade through a fire gradient */
	function jet(worldPos, dir) {
		const N = 150, EMIT = 0.85, LIFE = 0.42, d = dir.clone().normalize();
		const perp1 = new THREE.Vector3().crossVectors(d, Math.abs(d.y) > 0.9 ? new THREE.Vector3(1, 0, 0) : new THREE.Vector3(0, 1, 0)).normalize();
		const perp2 = new THREE.Vector3().crossVectors(d, perp1).normalize();
		const g = new THREE.BufferGeometry(), pos = new Float32Array(N * 3), col = new Float32Array(N * 3);
		g.setAttribute("position", new THREE.BufferAttribute(pos, 3)); g.setAttribute("color", new THREE.BufferAttribute(col, 3));
		const m = new THREE.PointsMaterial({ size: 0.17, vertexColors: true, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending });
		const pts = new THREE.Points(g, m); scene.add(pts); const _c = new THREE.Color();
		const P = [];
		for (let i = 0; i < N; i++) {
			const spread = perp1.clone().multiplyScalar(rand(-0.5, 0.5)).add(perp2.clone().multiplyScalar(rand(-0.5, 0.5)));
			P.push({ spawn: rand(0, EMIT), life: LIFE * rand(0.7, 1.3), vel: d.clone().multiplyScalar(rand(3, 6)).add(spread) });
		}
		let t = 0;
		push({
			update: (dt) => {
				t += dt; let alive = false;
				for (let i = 0; i < N; i++) {
					const q = P[i], age = t - q.spawn;
					if (age < 0 || age > q.life) { col[i * 3] = col[i * 3 + 1] = col[i * 3 + 2] = 0; continue; }
					alive = true; const lf = 1 - age / q.life;
					pos[i * 3] = worldPos.x + q.vel.x * age; pos[i * 3 + 1] = worldPos.y + q.vel.y * age; pos[i * 3 + 2] = worldPos.z + q.vel.z * age;
					_c.setHSL(0.14 * lf, 1, 0.35 + 0.35 * lf);   // white-hot young -> deep red as it cools
					col[i * 3] = _c.r * lf; col[i * 3 + 1] = _c.g * lf; col[i * 3 + 2] = _c.b * lf;
				}
				g.attributes.position.needsUpdate = true; g.attributes.color.needsUpdate = true;
				return alive || t <= EMIT;
			},
			dispose: () => { scene.remove(pts); g.dispose(); m.dispose(); },
		});
		return true;
	}

	function disposeObj(o) { o.traverse((n) => { if (n.isMesh) { n.geometry?.dispose?.(); const mm = n.material; Array.isArray(mm) ? mm.forEach((x) => x?.dispose?.()) : mm?.dispose?.(); } }); }

	/**
	 * Launcher: fly a pre-oriented projectile (rocket or soda can) down the barrel,
	 * leaving an ammo-specific trail — a fiery smoke plume for rockets, rising blue
	 * bubbles for cans. `proj` is a baked, oriented THREE.Object3D from the library.
	 */
	function launcher(worldPos, dir, ammo, proj) {
		const d = dir.clone().normalize(), isCan = ammo === "can";
		proj.position.copy(worldPos); scene.add(proj);
		const SPEED = isCan ? 5.5 : 8.5, DUR = 1.1, CAP = 240;
		const g = new THREE.BufferGeometry(), pos = new Float32Array(CAP * 3), col = new Float32Array(CAP * 3);
		g.setAttribute("position", new THREE.BufferAttribute(pos, 3)); g.setAttribute("color", new THREE.BufferAttribute(col, 3));
		const m = new THREE.PointsMaterial({ size: isCan ? 0.1 : 0.14, vertexColors: true, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending });
		const pts = new THREE.Points(g, m); pts.frustumCulled = false; scene.add(pts);
		const born = new Float32Array(CAP).fill(-1), life = new Float32Array(CAP), rise = new Float32Array(CAP);
		const baseC = new THREE.Color(); let head = 0, t = 0, spin = 0;
		push({
			update: (dt) => {
				t += dt; proj.position.addScaledVector(d, SPEED * dt);
				if (isCan) { spin += dt * 9; proj.rotation.set(spin, spin * 0.6, spin * 0.4); }
				const emit = isCan ? 2 : 5;                    // spawn trail particles at the tail
				for (let e = 0; e < emit; e++) {
					const i = head % CAP; head++;
					pos[i * 3] = proj.position.x + rand(-0.05, 0.05); pos[i * 3 + 1] = proj.position.y + rand(-0.05, 0.05); pos[i * 3 + 2] = proj.position.z + rand(-0.05, 0.05);
					born[i] = t; life[i] = isCan ? 0.8 : 0.55; rise[i] = isCan ? rand(0.25, 0.7) : rand(-0.1, 0.15);
				}
				for (let i = 0; i < CAP; i++) {
					if (born[i] < 0) { col[i * 3] = col[i * 3 + 1] = col[i * 3 + 2] = 0; continue; }
					const lf = 1 - (t - born[i]) / life[i];
					if (lf <= 0) { col[i * 3] = col[i * 3 + 1] = col[i * 3 + 2] = 0; continue; }
					pos[i * 3 + 1] += rise[i] * dt;             // bubbles float up / smoke drifts
					if (isCan) baseC.setRGB(0.35, 0.65, 1.0); else baseC.setHSL(0.06 * lf, 1, 0.5);
					col[i * 3] = baseC.r * lf; col[i * 3 + 1] = baseC.g * lf; col[i * 3 + 2] = baseC.b * lf;
				}
				g.attributes.position.needsUpdate = true; g.attributes.color.needsUpdate = true;
				return t < DUR;
			},
			dispose: () => { scene.remove(proj); scene.remove(pts); g.dispose(); m.dispose(); disposeObj(proj); },
		});
		return true;
	}

	return { jump, emp, magnet, jet, launcher, update, isJumping: () => jumping, setDebug, clearTrails };
}
