import * as THREE from "three";

/**
 * Falling confetti shower. Implemented as a single `InstancedMesh` of small
 * rectangular planes — one draw call for the whole cloud — with per-instance
 * position/rotation/color held in plain CPU arrays and decomposed into the
 * instance matrix each frame.
 *
 * Pattern adapted from three.js's instancing examples
 * (https://threejs.org/examples/#webgl_buffergeometry_instancing).
 *
 * Lifecycle:
 *   - `burst()` reseeds every piece above the dancer and makes the mesh visible.
 *   - `update(dt)` integrates physics; once all pieces have fallen below the
 *     floor, the mesh hides itself again so the GPU does no work between bursts.
 *   - `dispose()` frees the geometry + material.
 */

const COUNT = 220;

/**
 * Match the floor and club-lights palettes so the whole scene reads as a
 * single coordinated color story rather than three rainbows.
 */
const PALETTE = [
  0xff3366, 0xff9933, 0xffd633, 0x33ff99, 0x33ccff, 0x9933ff, 0xffffff,
];

// Slow, drifty confetti — gravity is roughly an eighth of real (~9.8 m/s² in
// these units would be ~245), which gives pieces ~20s to fall from the
// spawn band to the floor instead of a couple seconds. Spawn radius is wide
// enough that pieces appear across the whole canvas, not just over the dancer.
const GRAVITY = 35;
const DRAG = 0.6;
const SPAWN_Y_MIN = 600;
const SPAWN_Y_MAX = 820;
const SPAWN_RADIUS = 520;
const FLOOR_Y = -40;

interface Piece {
  px: number; py: number; pz: number;
  vx: number; vy: number; vz: number;
  rx: number; ry: number; rz: number;
  spinX: number; spinY: number; spinZ: number;
}

const tmpObject = new THREE.Object3D();
const tmpColor = new THREE.Color();

export interface Confetti {
  group: THREE.InstancedMesh;
  /** Reseed positions above the dancer and start a fresh fall. */
  burst: () => void;
  /** Per-frame physics integration. Pass the frame delta in seconds. */
  update: (deltaSeconds: number, paused?: boolean) => void;
  dispose: () => void;
}

export function buildConfetti(): Confetti {
  const geo = new THREE.PlaneGeometry(3, 6);
  const mat = new THREE.MeshStandardMaterial({
    side: THREE.DoubleSide,
    metalness: 0.05,
    roughness: 0.55,
    // Slight emissive lift so confetti reads against a light bg even when
    // the directional light is pointing the other way.
    emissive: 0xffffff,
    emissiveIntensity: 0.08,
  });

  const mesh = new THREE.InstancedMesh(geo, mat, COUNT);
  mesh.name = "disco-dancer-confetti";
  mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  mesh.frustumCulled = false;
  mesh.visible = false;
  mesh.castShadow = false;

  const pieces: Piece[] = new Array(COUNT);
  for (let i = 0; i < COUNT; i++) {
    pieces[i] = {
      px: 0, py: FLOOR_Y - 1, pz: 0,
      vx: 0, vy: 0, vz: 0,
      rx: 0, ry: 0, rz: 0,
      spinX: 0, spinY: 0, spinZ: 0,
    };
  }

  // Per-instance colors only need to be set once (random sample from the
  // palette per piece). Re-sampling on every burst would also work; once
  // is cheaper and still reads as variety.
  for (let i = 0; i < COUNT; i++) {
    tmpColor.setHex(PALETTE[i % PALETTE.length]);
    mesh.setColorAt(i, tmpColor);
  }
  if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;

  function burst() {
    mesh.visible = true;
    for (let i = 0; i < COUNT; i++) {
      const p = pieces[i];
      // Square-root sampling gives a roughly uniform area distribution,
      // so confetti looks evenly scattered rather than clumped at the
      // center.
      const angle = Math.random() * Math.PI * 2;
      const r = Math.sqrt(Math.random()) * SPAWN_RADIUS;
      p.px = Math.cos(angle) * r;
      p.py = SPAWN_Y_MIN + Math.random() * (SPAWN_Y_MAX - SPAWN_Y_MIN);
      p.pz = Math.sin(angle) * r;
      // Gentle initial velocity — most of the motion comes from gravity,
      // and DRAG quickly damps the horizontal component anyway.
      p.vx = (Math.random() - 0.5) * 20;
      p.vy = -(8 + Math.random() * 14);
      p.vz = (Math.random() - 0.5) * 20;
      p.rx = Math.random() * Math.PI * 2;
      p.ry = Math.random() * Math.PI * 2;
      p.rz = Math.random() * Math.PI * 2;
      // Slower tumble so pieces look like they're floating, not whipping.
      p.spinX = (Math.random() - 0.5) * 2.2;
      p.spinY = (Math.random() - 0.5) * 2.2;
      p.spinZ = (Math.random() - 0.5) * 2.2;
    }
    flushMatrices();
  }

  function flushMatrices() {
    for (let i = 0; i < COUNT; i++) {
      const p = pieces[i];
      tmpObject.position.set(p.px, p.py, p.pz);
      tmpObject.rotation.set(p.rx, p.ry, p.rz);
      tmpObject.updateMatrix();
      mesh.setMatrixAt(i, tmpObject.matrix);
    }
    mesh.instanceMatrix.needsUpdate = true;
  }

  function update(dt: number, paused = false) {
    if (paused || !mesh.visible) return;

    let allLanded = true;
    for (let i = 0; i < COUNT; i++) {
      const p = pieces[i];
      if (p.py < FLOOR_Y) continue;
      allLanded = false;

      // Linear drag — small enough that confetti still falls, but enough
      // that pieces drift sideways naturally instead of free-falling.
      p.vx -= p.vx * DRAG * dt;
      p.vz -= p.vz * DRAG * dt;
      p.vy -= GRAVITY * dt;

      p.px += p.vx * dt;
      p.py += p.vy * dt;
      p.pz += p.vz * dt;

      p.rx += p.spinX * dt;
      p.ry += p.spinY * dt;
      p.rz += p.spinZ * dt;
    }

    flushMatrices();

    if (allLanded) {
      // Park the cloud under the floor and stop drawing. Any subsequent
      // burst() call will respawn pieces above the dancer.
      mesh.visible = false;
    }
  }

  function dispose() {
    geo.dispose();
    mat.dispose();
  }

  return { group: mesh, burst, update, dispose };
}
