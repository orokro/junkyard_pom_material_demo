/**
 * ============================================================================
 * arena/three/flyCamera.js
 * ----------------------------------------------------------------------------
 * Two-mode camera (Tab toggles):
 *   - Walk (default): FPS walker; Y locked to surface + eye height.
 *   - Fly: free 6-DOF (WASD + Space/C, faster).
 * Mouse look (pointer lock) + Shift-boost in both.
 *
 * Arena addition: an optional HARD BOUNDS CLAMP. The playable area is a fixed
 * rectangle; the player/fly camera is clamped inside it (with a margin) and can
 * never leave or peek OOB — even though walls/props render beyond the bounds.
 * ============================================================================
 */

import * as THREE from "three";

const SENSITIVITY = 0.0022;
const PITCH_LIMIT = Math.PI / 2 - 0.01;
const BOOST = 3.0;
const STEP_UP = 0.75; // max instant rise while walking (climb ramps, not walls/edges)

/**
 * @typedef {object} FlyControls
 * @property {(dt: number) => void} update
 * @property {(speed: number) => void} setSpeed
 * @property {(speed: number) => void} setWalkSpeed
 * @property {(bounds: {minX:number,maxX:number,minZ:number,maxZ:number}|null) => void} setBounds
 * @property {(pos: THREE.Vector3Like, target: THREE.Vector3Like) => void} placeLookingAt
 * @property {() => boolean} isWalking
 * @property {() => void} dispose
 */

/**
 * @param {THREE.PerspectiveCamera} camera
 * @param {HTMLElement} dom
 * @param {{ speed?:number, walkSpeed?:number, eyeHeight?:number, getSurfaceHeight?:(x:number,z:number)=>number, startWalking?:boolean, bounds?:{minX:number,maxX:number,minZ:number,maxZ:number}|null, boundsMargin?:number }} [opts]
 * @returns {FlyControls}
 */
export function createFlyControls(camera, dom, opts = {}) {
	let yaw = 0;
	let pitch = 0;
	let flySpeed = opts.speed ?? 18;
	let walkSpeed = opts.walkSpeed ?? 4;
	const eyeHeight = opts.eyeHeight ?? 1.7;
	const getSurfaceHeight = opts.getSurfaceHeight ?? (() => 0);
	let walking = opts.startWalking ?? true;
	let locked = false;
	let bounds = opts.bounds ?? null;
	const margin = opts.boundsMargin ?? 0.6;

	/** @type {Record<string, boolean>} */
	const keys = {};
	const forward = new THREE.Vector3();
	const right = new THREE.Vector3();
	const move = new THREE.Vector3();
	const euler = new THREE.Euler(0, 0, 0, "YXZ");

	const onMouseMove = (e) => {
		if (!locked) return;
		// Ignore absurd deltas: when pointer lock re-engages (or on alt-tab) the
		// browser can emit one huge movementX/Y that snaps the view. Real moves are small.
		if (Math.abs(e.movementX) > 200 || Math.abs(e.movementY) > 200) return;
		yaw -= e.movementX * SENSITIVITY;
		pitch -= e.movementY * SENSITIVITY;
		pitch = Math.max(-PITCH_LIMIT, Math.min(PITCH_LIMIT, pitch));
	};
	const onKeyDown = (e) => {
		if (e.code === "Tab") {
			e.preventDefault();
			walking = !walking;
			return;
		}
		keys[e.code] = true;
	};
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

	/** @returns {void} Clamp camera XZ inside the playable bounds. */
	function clampBounds() {
		if (!bounds) return;
		camera.position.x = Math.min(Math.max(camera.position.x, bounds.minX + margin), bounds.maxX - margin);
		camera.position.z = Math.min(Math.max(camera.position.z, bounds.minZ + margin), bounds.maxZ - margin);
	}

	return {
		update(dt) {
			euler.set(pitch, yaw, 0, "YXZ");
			camera.quaternion.setFromEuler(euler);
			const boost = keys.ShiftLeft || keys.ShiftRight ? BOOST : 1;

			if (walking) {
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
					move.normalize().multiplyScalar(walkSpeed * boost * dt);
					// Per-axis so we slide along walls/edges instead of dead-stopping, and
					// each axis is blocked only if the step up is too tall to climb (ramps
					// rise gradually and stay under STEP_UP). Drops of any size are allowed.
					const baseY = camera.position.y;
					const stepAxis = (dx, dz) => {
						if (dx === 0 && dz === 0) return;
						const px = camera.position.x, pz = camera.position.z;
						camera.position.x += dx;
						camera.position.z += dz;
						clampBounds();
						if (getSurfaceHeight(camera.position.x, camera.position.z) + eyeHeight - baseY > STEP_UP) {
							camera.position.x = px;
							camera.position.z = pz;
						}
					};
					stepAxis(move.x, 0);
					stepAxis(0, move.z);
				}
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
				clampBounds();
			}
		},
		setSpeed(next) {
			flySpeed = next;
		},
		setWalkSpeed(next) {
			walkSpeed = next;
		},
		setBounds(next) {
			bounds = next;
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
