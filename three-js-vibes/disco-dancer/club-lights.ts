import * as THREE from "three";

/**
 * Six colored ceiling spotlights that sweep their targets in independent
 * circles around the dancer, mimicking a small club lighting rig. Two of the
 * six cast shadows so the dancer reads as lit from above without paying for
 * six full-resolution shadow maps every frame.
 *
 * `enable()` ramps intensity from 0 to its target over ~1s the first time
 * it's called — the show-controller fires it once when the lights kick on.
 */

const COLORS = [0xff3366, 0xff9933, 0xffd633, 0x33ff99, 0x33ccff, 0x9933ff];

const CEILING_Y = 380;
const RING_RADIUS = 280;

const TARGET_INTENSITY = 1.6;
const RAMP_DURATION_MS = 1000;

interface LightSlot {
  light: THREE.SpotLight;
  target: THREE.Object3D;
  bulb: THREE.Mesh<THREE.SphereGeometry, THREE.MeshBasicMaterial>;
  baseAngle: number;
  /** Floor-level radius the target sweeps in. */
  sweepRadius: number;
  /** Sweep angular speed (rad/s). */
  sweepSpeed: number;
}

export interface ClubLights {
  group: THREE.Group;
  /** Ramp on (idempotent — calling again resets the ramp from current intensity). */
  enable: () => void;
  /** Per-frame target sweep + intensity ramp integration. */
  update: (deltaSeconds: number, elapsedSeconds: number, paused?: boolean) => void;
  dispose: () => void;
}

export function buildClubLights(): ClubLights {
  const group = new THREE.Group();
  group.name = "disco-dancer-club-lights";

  const slots: LightSlot[] = [];
  const bulbGeo = new THREE.SphereGeometry(6, 16, 12);

  for (let i = 0; i < COLORS.length; i++) {
    const color = COLORS[i];
    const theta = (i / COLORS.length) * Math.PI * 2;

    const light = new THREE.SpotLight(
      color,
      0,
      720,
      Math.PI / 7,
      0.45,
      1.2,
    );
    light.position.set(
      Math.cos(theta) * RING_RADIUS,
      CEILING_Y,
      Math.sin(theta) * RING_RADIUS,
    );
    if (i < 2) {
      light.castShadow = true;
      light.shadow.mapSize.set(512, 512);
      light.shadow.camera.near = 50;
      light.shadow.camera.far = 800;
      light.shadow.bias = -0.001;
    }

    const target = new THREE.Object3D();
    target.position.set(0, 30, 0);
    light.target = target;

    // Visible "bulb" so the rig looks anchored on the ceiling (matches what
    // your eye expects after seeing the colored beam-end on the floor).
    const bulbMat = new THREE.MeshBasicMaterial({ color });
    const bulb = new THREE.Mesh(bulbGeo, bulbMat);
    bulb.position.copy(light.position);

    group.add(light, target, bulb);

    slots.push({
      light,
      target,
      bulb,
      baseAngle: theta,
      // Stagger sweep radii and speeds so the beams don't move in lockstep.
      sweepRadius: 110 + (i % 3) * 35 + Math.random() * 30,
      sweepSpeed: 0.55 + (i / COLORS.length) * 0.7 + Math.random() * 0.15,
    });
  }

  let rampStart: number | null = null;
  let rampFrom = 0;

  function enable() {
    rampStart = performance.now();
    rampFrom = slots[0]?.light.intensity ?? 0;
  }

  function update(_dt: number, elapsed: number, paused = false) {
    if (paused) {
      // Hold whatever intensity was set; freeze sweep.
      return;
    }

    // Intensity ramp on first enable() (and re-enables).
    if (rampStart !== null) {
      const t = Math.min(1, (performance.now() - rampStart) / RAMP_DURATION_MS);
      const eased = t * t * (3 - 2 * t);
      const intensity = rampFrom + (TARGET_INTENSITY - rampFrom) * eased;
      for (const s of slots) s.light.intensity = intensity;
      if (t >= 1) rampStart = null;
    }

    // Sweep targets in circles. Each slot has its own angular speed and radius.
    for (const s of slots) {
      const a = s.baseAngle + elapsed * s.sweepSpeed;
      s.target.position.set(
        Math.cos(a) * s.sweepRadius,
        30,
        Math.sin(a) * s.sweepRadius,
      );
      s.target.updateMatrixWorld();
    }
  }

  function dispose() {
    for (const s of slots) {
      s.bulb.material.dispose();
      // Lights themselves don't need explicit disposal; removing them from
      // the scene + losing references is enough.
    }
    bulbGeo.dispose();
  }

  return { group, enable, update, dispose };
}
