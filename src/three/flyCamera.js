/**
 * ============================================================================
 * three/flyCamera.js
 * ----------------------------------------------------------------------------
 * Free-fly camera controls: pointer-lock mouse look + WASD movement, Shift to
 * boost, Space/C for vertical. Yaw/pitch are tracked explicitly (YXZ euler) so
 * there is no roll. Movement is frame-rate independent (scaled by dt).
 * ============================================================================
 */

import * as THREE from "three";

const SENSITIVITY = 0.0022;
const PITCH_LIMIT = Math.PI / 2 - 0.01;

/**
 * @typedef {object} FlyControls
 * @property {(dt: number) => void} update Advance one frame.
 * @property {(speed: number) => void} setSpeed Set base fly speed (m/s).
 * @property {(pos: THREE.Vector3Like, target: THREE.Vector3Like) => void} placeLookingAt Reset pose.
 * @property {() => void} dispose Remove listeners.
 */

/**
 * Attach fly controls to a camera.
 * @param {THREE.PerspectiveCamera} camera Camera to drive.
 * @param {HTMLElement} dom Element that captures pointer lock (the canvas).
 * @param {number} [speed] Base movement speed in m/s.
 * @returns {FlyControls} Control handle.
 */
export function createFlyControls(camera, dom, speed = 18) {
	let yaw = 0;
	let pitch = 0;
	let baseSpeed = speed;
	const boost = 3.2;
	let locked = false;

	/** @type {Record<string, boolean>} */
	const keys = {};

	const forward = new THREE.Vector3();
	const right = new THREE.Vector3();
	const move = new THREE.Vector3();
	const euler = new THREE.Euler(0, 0, 0, "YXZ");

	/** @param {MouseEvent} e */
	const onMouseMove = (e) => {
		if (!locked) return;
		yaw -= e.movementX * SENSITIVITY;
		pitch -= e.movementY * SENSITIVITY;
		pitch = Math.max(-PITCH_LIMIT, Math.min(PITCH_LIMIT, pitch));
	};
	/** @param {KeyboardEvent} e */
	const onKeyDown = (e) => {
		keys[e.code] = true;
	};
	/** @param {KeyboardEvent} e */
	const onKeyUp = (e) => {
		keys[e.code] = false;
	};
	const onClick = () => dom.requestPointerLock();
	const onLockChange = () => {
		locked = document.pointerLockElement === dom;
	};

	dom.addEventListener("click", onClick);
	document.addEventListener("pointerlockchange", onLockChange);
	document.addEventListener("mousemove", onMouseMove);
	window.addEventListener("keydown", onKeyDown);
	window.addEventListener("keyup", onKeyUp);

	return {
		update(dt) {
			euler.set(pitch, yaw, 0, "YXZ");
			camera.quaternion.setFromEuler(euler);

			forward.set(0, 0, -1).applyQuaternion(camera.quaternion);
			right.set(1, 0, 0).applyQuaternion(camera.quaternion);
			move.set(0, 0, 0);

			if (keys.KeyW) move.add(forward);
			if (keys.KeyS) move.sub(forward);
			if (keys.KeyD) move.add(right);
			if (keys.KeyA) move.sub(right);
			if (keys.Space) move.y += 1;
			if (keys.KeyC || keys.ControlLeft) move.y -= 1;

			if (move.lengthSq() > 0) {
				move.normalize();
				const sp = baseSpeed * (keys.ShiftLeft || keys.ShiftRight ? boost : 1);
				camera.position.addScaledVector(move, sp * dt);
			}
		},
		setSpeed(next) {
			baseSpeed = next;
		},
		placeLookingAt(pos, target) {
			camera.position.set(pos.x, pos.y, pos.z);
			const dir = new THREE.Vector3(target.x - pos.x, target.y - pos.y, target.z - pos.z).normalize();
			pitch = Math.asin(THREE.MathUtils.clamp(dir.y, -1, 1));
			yaw = Math.atan2(-dir.x, -dir.z);
		},
		dispose() {
			dom.removeEventListener("click", onClick);
			document.removeEventListener("pointerlockchange", onLockChange);
			document.removeEventListener("mousemove", onMouseMove);
			window.removeEventListener("keydown", onKeyDown);
			window.removeEventListener("keyup", onKeyUp);
			if (document.pointerLockElement === dom) document.exitPointerLock();
		},
	};
}
