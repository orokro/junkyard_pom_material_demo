/**
 * ============================================================================
 * three/flyCamera.js
 * ----------------------------------------------------------------------------
 * Camera controls with two modes, toggled by Tab:
 *
 *   - Walk (default): an FPS-style walker. Horizontal WASD from the yaw only
 *     (looking up/down doesn't move you vertically); the camera Y is locked to
 *     the terrain surface + eye height, sampled from the height field (no
 *     raycast). Walking into a cliff simply snaps you on top — intentional.
 *   - Fly: free 6-DOF flight (WASD + Space/C, faster).
 *
 * Mouse look (pointer lock) and Shift-boost apply in both modes.
 * ============================================================================
 */

import * as THREE from "three";

const SENSITIVITY = 0.0022;
const PITCH_LIMIT = Math.PI / 2 - 0.01;
const BOOST = 3.0;

/**
 * @typedef {object} FlyControls
 * @property {(dt: number) => void} update
 * @property {(speed: number) => void} setSpeed Fly speed (m/s).
 * @property {(speed: number) => void} setWalkSpeed Walk speed (m/s).
 * @property {(pos: THREE.Vector3Like, target: THREE.Vector3Like) => void} placeLookingAt
 * @property {() => boolean} isWalking
 * @property {() => void} dispose
 */

/**
 * Attach camera controls.
 * @param {THREE.PerspectiveCamera} camera
 * @param {HTMLElement} dom Pointer-lock target (canvas).
 * @param {{ speed?: number, walkSpeed?: number, eyeHeight?: number, getSurfaceHeight?: (x: number, z: number) => number, startWalking?: boolean, minX?: number }} [opts]
 * @returns {FlyControls}
 */
export function createFlyControls(camera, dom, opts = {}) {
	let yaw = 0;
	let pitch = 0;
	let flySpeed = opts.speed ?? 18;
	let walkSpeed = opts.walkSpeed ?? 4;
	const eyeHeight = opts.eyeHeight ?? 1.7;
	const getSurfaceHeight = opts.getSurfaceHeight ?? (() => 0);
	const minX = opts.minX ?? -Infinity; // western boundary (edge wall)
	let walking = opts.startWalking ?? true;
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
		if (e.code === "Tab") {
			e.preventDefault();
			walking = !walking;
			return;
		}
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

			const boost = keys.ShiftLeft || keys.ShiftRight ? BOOST : 1;

			if (walking) {
				// Horizontal heading only (ignore pitch), so looking up/down doesn't fly.
				forward.set(0, 0, -1).applyQuaternion(camera.quaternion);
				forward.y = 0;
				if (forward.lengthSq() < 1e-6) forward.set(0, 0, -1);
				forward.normalize();
				right.set(1, 0, 0).applyQuaternion(camera.quaternion);
				right.y = 0;
				right.normalize();

				move.set(0, 0, 0);
				if (keys.KeyW) move.add(forward);
				if (keys.KeyS) move.sub(forward);
				if (keys.KeyD) move.add(right);
				if (keys.KeyA) move.sub(right);
				if (move.lengthSq() > 0) {
					move.normalize();
					camera.position.addScaledVector(move, walkSpeed * boost * dt);
				}
				if (camera.position.x < minX) camera.position.x = minX; // hold at the edge wall
				// Stick to the surface.
				camera.position.y = getSurfaceHeight(camera.position.x, camera.position.z) + eyeHeight;
			} else {
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
					camera.position.addScaledVector(move, flySpeed * boost * dt);
				}
				if (camera.position.x < minX) camera.position.x = minX; // hold at the edge wall
			}
		},
		setSpeed(next) {
			flySpeed = next;
		},
		setWalkSpeed(next) {
			walkSpeed = next;
		},
		placeLookingAt(pos, target) {
			camera.position.set(pos.x, pos.y, pos.z);
			const dir = new THREE.Vector3(target.x - pos.x, target.y - pos.y, target.z - pos.z).normalize();
			pitch = Math.asin(THREE.MathUtils.clamp(dir.y, -1, 1));
			yaw = Math.atan2(-dir.x, -dir.z);
		},
		isWalking() {
			return walking;
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
