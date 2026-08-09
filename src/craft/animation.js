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

const easeOut = (x) => 1 - Math.pow(1 - x, 3);       // fast start, gentle stop
const easeIn = (x) => x * x * x;

/** continuous per-frame motion (always on while attached) */
const CONT = {
	saw: (r, dt) => { if (r.joints.blade) r.joints.blade.rotation.x += 15 * dt; },
};

/** snap a rig to its rest pose */
const REST = {
	ram: (r) => { if (r.joints.rod) r.joints.rod.position.x = -r.contract; },
	saw: () => {},
};

/**
 * One-shot animations. Each returns true when finished (then the rig is reset).
 * `t` is seconds since the fire. Timing: quick punch out, slightly slower retract.
 */
const RAM_OUT = 0.11, RAM_BACK = 0.26;
const ANIM = {
	ram: (r, t) => {
		const c = r.contract;                        // rest x = -c, full extension = 0
		if (t < RAM_OUT) { r.joints.rod.position.x = -c * (1 - easeOut(t / RAM_OUT)); return false; }
		if (t < RAM_OUT + RAM_BACK) { r.joints.rod.position.x = -c * easeIn((t - RAM_OUT) / RAM_BACK); return false; }
		r.joints.rod.position.x = -c; return true;
	},
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
		update(dt) {
			for (const rig of rigs) CONT[rig.type]?.(rig, dt);
			for (const [rig, st] of active) {
				st.t += dt;
				if (ANIM[rig.type](rig, st.t)) { active.delete(rig); REST[rig.type]?.(rig); }
			}
		},
	};
}
