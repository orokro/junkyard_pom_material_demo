/**
 * ============================================================================
 * craft/animation.js
 * ----------------------------------------------------------------------------
 * Drives the live weapon rigs produced by library.bakeRig(). Registered rigs get
 * their continuous motion (saw blade spin) every frame; a key-fire plays a
 * one-shot animation (ram thrust, arm snap, scorpion strike). Animations are
 * NON-INTERRUPTIBLE — a rig that's mid-animation ignores new fires until it
 * returns to rest. Carview owns one animator and calls update(dt) from its tick.
 * ============================================================================
 */

import * as THREE from "three";

const easeOut = (x) => 1 - Math.pow(1 - x, 3);       // fast start, gentle stop
const easeIn = (x) => x * x * x;

/** Elbow snap: forearm hinges about local Y, FORWARD (toward the car front). Tunable. */
const ARM_BEND = 1.2;
const ARM_OUT = 0.09, ARM_BACK = 0.24;

const _v = new THREE.Vector3(), _dir = new THREE.Vector3();
/**
 * Keep an aiming piston glued to a moving point: aim the barrel from its origin at
 * the target empty and slide the rod so its tip reaches the target distance.
 * @param {object} j joints with {barrel, rod, target, axis, restTipLen}
 */
function solvePiston(j) {
	const { barrel, rod, target, axis, restTipLen } = j;
	barrel.parent.updateWorldMatrix(true, false);
	target.updateWorldMatrix(true, false);
	const tLocal = barrel.parent.worldToLocal(target.getWorldPosition(_v));   // target in barrel's parent frame
	_dir.copy(tLocal).sub(barrel.position);                                   // barrel origin -> target
	const dist = _dir.length() || 1e-4;
	barrel.quaternion.setFromUnitVectors(axis, _dir.divideScalar(dist));      // aim
	rod.position.copy(axis).multiplyScalar(dist - restTipLen);                // stretch/contract to reach
}

/** pose the arm: forearm bent by fraction f, piston following */
function armPose(r, f) {
	const j = r.joints;
	j.forearm.rotation.set(j.restX || 0, (j.restY || 0) + ARM_BEND * f, j.restZ || 0);   // snap about Y (forward)
	r.group.updateWorldMatrix(true, true);           // refresh world before the piston solve
	solvePiston(j);
}

// ---- scorpion tail ----
const SCORP_SWEEP = Math.PI / 4;      // max ± sweep (pivot Y) = 45°
const SCORP_TILT = 1.2;               // root X tilt on strike — whips the tail forward + down
const SCORP_CURL_MIN = 0.4;           // segments uncurl to ~this fraction of rest curl (keeps a strike arc)
const SCORP_T = { sweep: 0.30, strike: 0.13, recoil: 0.34, ret: 0.28 };  // phase durations (s)
/** pose the tail: pivot swept by sweepAngle (rad), strike fraction 0..1 (root tilt + uncurl + piston) */
function scorpPose(r, sweepAngle, strikeF) {
	const j = r.joints;
	j.pivot.rotation.y = j.pivotRest + sweepAngle;
	j.root.rotation.x = j.rootRestX + SCORP_TILT * strikeF;
	const curl = 1 - (1 - SCORP_CURL_MIN) * strikeF;                     // 1 coiled -> CURL_MIN extended
	j.segments.forEach((seg, i) => { const rr = j.segRest[i]; seg.rotation.set(rr.x, rr.y * curl, rr.z); });
	r.group.updateWorldMatrix(true, true);
	solvePiston(j);
}

/** continuous per-frame motion (always on while attached) */
const CONT = {
	saw: (r, dt) => { if (r.joints.blade) r.joints.blade.rotation.x += 15 * dt; },
};

/** snap a rig to its rest pose */
const REST = {
	ram: (r) => { if (r.joints.rod) r.joints.rod.position.x = -r.contract; },
	saw: () => {},
	arm: (r) => armPose(r, 0),
	scorpion: (r) => scorpPose(r, 0, 0),
};

/**
 * One-shot animations. Each returns true when finished (then the rig is reset).
 * `t` is seconds since the fire. Timing: quick punch out, slightly slower retract.
 */
const RAM_OUT = 0.07, RAM_BACK = 0.26;
const ANIM = {
	ram: (r, t) => {
		const c = r.contract;                        // rest x = -c, full extension = 0
		if (t < RAM_OUT) { r.joints.rod.position.x = -c * (1 - easeOut(t / RAM_OUT)); return false; }
		if (t < RAM_OUT + RAM_BACK) { r.joints.rod.position.x = -c * easeIn((t - RAM_OUT) / RAM_BACK); return false; }
		r.joints.rod.position.x = -c; return true;
	},
	arm: (r, t) => {                                 // elbow snaps shut, then eases back open
		if (t < ARM_OUT) { armPose(r, easeOut(t / ARM_OUT)); return false; }
		if (t < ARM_OUT + ARM_BACK) { armPose(r, 1 - easeIn((t - ARM_OUT) / ARM_BACK)); return false; }
		armPose(r, 0); return true;
	},
	// two-step: sweep the pivot to a random ±angle, THEN strike (root tilt + uncurl + piston), recoil, return
	scorpion: (r, t, st) => {
		if (st.sweep === undefined) st.sweep = (Math.random() * 2 - 1) * SCORP_SWEEP;
		const T = SCORP_T, t1 = T.sweep, t2 = t1 + T.strike, t3 = t2 + T.recoil, t4 = t3 + T.ret;
		if (t < t1) { scorpPose(r, st.sweep * easeInOut(t / t1), 0); return false; }
		if (t < t2) { scorpPose(r, st.sweep, easeOut((t - t1) / T.strike)); return false; }
		if (t < t3) { scorpPose(r, st.sweep, 1 - easeIn((t - t2) / T.recoil)); return false; }
		if (t < t4) { scorpPose(r, st.sweep * (1 - easeInOut((t - t3) / T.ret)), 0); return false; }
		scorpPose(r, 0, 0); return true;
	},
};
const easeInOut = (x) => (x < 0.5 ? 2 * x * x : 1 - Math.pow(-2 * x + 2, 2) / 2);

/** pose a rig at animation fraction f (0=rest, 1=peak) — used for tests/tuning */
const POSE = {
	ram: (r, f) => { r.joints.rod.position.x = -r.contract * (1 - f); },
	arm: (r, f) => armPose(r, f),
	scorpion: (r, f) => scorpPose(r, 0, f),                 // pure strike (no sweep) for tuning
	scorpionSweep: (r, f) => scorpPose(r, SCORP_SWEEP * f, 0),
};

export function makeRigAnimator() {
	const rigs = new Set();            // every live rig (for continuous motion)
	const active = new Map();          // rig -> { t } one-shot in progress

	return {
		add(rig) { if (!rig) return; rigs.add(rig); REST[rig.type]?.(rig); },
		remove(rig) { if (!rig) return; rigs.delete(rig); active.delete(rig); },
		isBusy(rig) { return active.has(rig); },
		/** start a one-shot; ignored if busy or the type has no one-shot */
		fire(rig) { if (!rig || active.has(rig) || !ANIM[rig.type]) return false; active.set(rig, { t: 0 }); return true; },
		pose(rig, f) { POSE[rig.type]?.(rig, f); },     // test/tuning hook
		/** test hook: set the arm forearm to raw euler deltas from rest, then solve the piston */
		poseArmRaw(rig, ex, ey, ez) {
			const j = rig.joints; if (!j || !j.forearm) return;
			j.forearm.rotation.set((j.restX || 0) + ex, (j.restY || 0) + ey, (j.restZ || 0) + ez);
			rig.group.updateWorldMatrix(true, true); solvePiston(j);
		},
		update(dt) {
			for (const rig of rigs) CONT[rig.type]?.(rig, dt);
			for (const [rig, st] of active) {
				st.t += dt;
				if (ANIM[rig.type](rig, st.t, st)) { active.delete(rig); REST[rig.type]?.(rig); }
			}
		},
	};
}
