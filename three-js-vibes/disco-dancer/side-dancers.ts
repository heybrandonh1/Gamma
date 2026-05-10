import * as THREE from "three";
import { clone as cloneSkeleton } from "three/examples/jsm/utils/SkeletonUtils.js";

import { attachPirateOutfit, type PirateOutfit } from "./pirate-outfit";

/**
 * Two background dancers that periodically walk in from offscreen, samba
 * alongside the lead dancer for a few seconds, then walk back out the way
 * they came.
 *
 * They share the lead dancer's loaded FBX (cloned via `SkeletonUtils.clone`
 * so geometries / materials are reused) and each get their own
 * `AnimationMixer`. Because we only have one clip — samba — "walking" is
 * just the samba loop while we translate the root horizontally; visually
 * it reads as the dancer grooving on/off stage rather than as a gait
 * mismatch.
 *
 * Side-dancer geometries / materials are owned by the source FBX, so
 * dispose() only needs to detach mixers and stop animations. The host
 * disposes the source itself when the main scene tears down.
 */

const SIDE_SCALE = 0.82;

// X positions: dancers start well past the visible frame edge so the
// walk-in reads as "stepping on stage" rather than "popping in".
const OFFSCREEN_X = 420;
const STAGE_X = 175;
// Slight Z stagger so the pair frames the lead dancer rather than
// occluding them. Left dancer sits a touch upstage (toward the camera),
// right dancer a touch downstage, so neither lines up flush with the
// lead's silhouette.
const LEFT_STAGE_Z = 50;
const RIGHT_STAGE_Z = -40;

const WALK_IN_MS = 4500;
const DANCE_MS = 8500;
const WALK_OUT_MS = 4500;

// Gap between the end of one cycle and the start of the next, picked
// per-dancer so the two never sync up after the first stagger.
const CYCLE_GAP_MIN_MS = 9000;
const CYCLE_GAP_MAX_MS = 16000;

// Dancer B's first cycle is delayed by this much so the two don't enter
// in lockstep on the first run.
const SECOND_DANCER_STAGGER_MS = 3500;

interface SideDancerSlot {
  root: THREE.Object3D;
  mixer: THREE.AnimationMixer;
  outfit: PirateOutfit;
  /** Sign of the dancer's X axis: -1 = enters from the left, +1 = right. */
  side: -1 | 1;
  /** Resting Z position when on stage. */
  stageZ: number;
  /** `performance.now()` of the current cycle's start, or null if waiting. */
  cycleStart: number | null;
  /** `performance.now()` after which the next cycle may begin. */
  nextCycleAt: number;
}

export interface SideDancerRig {
  /** Add to the scene to expose the cloned dancers. */
  group: THREE.Group;
  /**
   * Drive every frame. `delta` advances each clone's mixer; `now` /
   * `paused` schedule the walk-in / dance / walk-out cycles. Cheap —
   * two mixer updates plus a couple of lerps.
   */
  update: (delta: number, now: number, paused: boolean) => void;
  dispose: () => void;
}

export interface BuildSideDancersOptions {
  /** Already-loaded source FBX from the lead dancer. Cloned, not mutated. */
  source: THREE.Object3D;
  /** Samba clip — the same one the lead dancer is playing. */
  clip: THREE.AnimationClip;
}

/**
 * Smooth ease-in-out for the walk-in / walk-out lerps. Linear motion
 * looks robotic; this softens the start and stop so the dancers seem
 * to step on/off the stage rather than slide.
 */
function easeInOut(x: number): number {
  return x < 0.5 ? 2 * x * x : 1 - Math.pow(-2 * x + 2, 2) / 2;
}

function randCycleGap(): number {
  return CYCLE_GAP_MIN_MS + Math.random() * (CYCLE_GAP_MAX_MS - CYCLE_GAP_MIN_MS);
}

export function buildSideDancers(opts: BuildSideDancersOptions): SideDancerRig {
  const { source, clip } = opts;

  const group = new THREE.Group();
  group.name = "disco-dancer-side-dancers";

  const slots: SideDancerSlot[] = [];
  const mountedAt = performance.now();

  for (let i = 0; i < 2; i++) {
    // SkeletonUtils.clone correctly rebuilds the skinned-mesh skeleton so
    // each clone animates independently — a plain `Object3D.clone()` would
    // share bone references and the two dancers would T-pose-fight.
    const clone = cloneSkeleton(source);
    clone.scale.setScalar(SIDE_SCALE);

    clone.traverse((child: THREE.Object3D) => {
      if ((child as THREE.Mesh).isMesh) {
        (child as THREE.Mesh).castShadow = true;
        (child as THREE.Mesh).receiveShadow = true;
      }
    });

    const side: -1 | 1 = i === 0 ? -1 : 1;
    const stageZ = side < 0 ? LEFT_STAGE_Z : RIGHT_STAGE_Z;

    // Park them offscreen until their first cycle fires. Facing toward
    // the stage so the first walk-in already reads correctly.
    clone.position.set(OFFSCREEN_X * side, 0, stageZ);
    clone.rotation.y = side < 0 ? Math.PI / 2 : -Math.PI / 2;

    const mixer = new THREE.AnimationMixer(clone);
    const action = mixer.clipAction(clip);
    // Slight per-clone time-scale jitter so the two clones don't samba
    // in perfect frame-lock with each other or the lead.
    action.timeScale = 0.94 + Math.random() * 0.12;
    action.play();

    // Each side dancer gets the full pirate outfit at a smaller scale
    // so the trio reads as a coherent crew rather than the lead alone
    // in costume. tintBody is false because SkeletonUtils.clone shares
    // materials with the source — the lead's tint already shows on the
    // clones, so a second pass would double-darken.
    const outfit = attachPirateOutfit({
      root: clone,
      scale: 0.72,
      tintBody: false,
    });

    group.add(clone);

    slots.push({
      root: clone,
      mixer,
      outfit,
      side,
      stageZ,
      cycleStart: null,
      nextCycleAt:
        mountedAt + 2000 + (i === 0 ? 0 : SECOND_DANCER_STAGGER_MS),
    });
  }

  function update(delta: number, now: number, paused: boolean) {
    if (paused) return;

    for (const slot of slots) {
      slot.mixer.update(delta);

      // Idle: waiting for the next cycle to start.
      if (slot.cycleStart === null) {
        if (now >= slot.nextCycleAt) {
          slot.cycleStart = now;
        } else {
          continue;
        }
      }

      const t = now - slot.cycleStart;
      const total = WALK_IN_MS + DANCE_MS + WALK_OUT_MS;

      if (t >= total) {
        // Cycle done — park offscreen and re-arm the timer.
        slot.cycleStart = null;
        slot.nextCycleAt = now + randCycleGap();
        slot.root.position.set(OFFSCREEN_X * slot.side, 0, slot.stageZ);
        slot.root.rotation.y =
          slot.side < 0 ? Math.PI / 2 : -Math.PI / 2;
        continue;
      }

      // Phase 1: walk in from offscreen toward the stage X.
      if (t < WALK_IN_MS) {
        const k = easeInOut(t / WALK_IN_MS);
        slot.root.position.x = THREE.MathUtils.lerp(
          OFFSCREEN_X * slot.side,
          STAGE_X * slot.side,
          k,
        );
        slot.root.position.z = slot.stageZ;
        // Face toward center while walking on. Soften the rotation as we
        // arrive so the turn-to-camera at the dance phase isn't a snap.
        const turnK = Math.min(1, (t / WALK_IN_MS - 0.6) / 0.4);
        const walkRot = slot.side < 0 ? Math.PI / 2 : -Math.PI / 2;
        // Final on-stage facing has a gentle inward angle so left and
        // right dancers angle toward the center of the trio rather than
        // both staring straight at the camera.
        const stageRot = slot.side < 0 ? 0.25 : -0.25;
        slot.root.rotation.y = THREE.MathUtils.lerp(
          walkRot,
          stageRot,
          Math.max(0, turnK),
        );
        continue;
      }

      // Phase 2: dance on stage.
      if (t < WALK_IN_MS + DANCE_MS) {
        slot.root.position.x = STAGE_X * slot.side;
        slot.root.position.z = slot.stageZ;
        slot.root.rotation.y = slot.side < 0 ? 0.25 : -0.25;
        continue;
      }

      // Phase 3: walk back out the way they came.
      const outT = (t - WALK_IN_MS - DANCE_MS) / WALK_OUT_MS;
      const k = easeInOut(outT);
      slot.root.position.x = THREE.MathUtils.lerp(
        STAGE_X * slot.side,
        OFFSCREEN_X * slot.side,
        k,
      );
      slot.root.position.z = slot.stageZ;
      // Pivot from "facing camera-ish" back to "facing exit" early in the
      // walk-out so the body isn't sliding sideways.
      const turnK = Math.min(1, outT / 0.25);
      const stageRot = slot.side < 0 ? 0.25 : -0.25;
      const exitRot = slot.side < 0 ? -Math.PI / 2 : Math.PI / 2;
      slot.root.rotation.y = THREE.MathUtils.lerp(stageRot, exitRot, turnK);
    }
  }

  function dispose() {
    for (const slot of slots) {
      slot.mixer.stopAllAction();
      slot.mixer.uncacheRoot(slot.root);
      slot.outfit.dispose();
      // SkeletonUtils.clone shares geometry/material with the source FBX,
      // so we MUST NOT dispose those — that's the host's job when the
      // source itself unmounts. The cloned Skeleton (bone matrix texture)
      // is per-instance, though, so dispose just that.
      slot.root.traverse((child: THREE.Object3D) => {
        const skinned = child as THREE.SkinnedMesh;
        if (skinned.isSkinnedMesh) skinned.skeleton.dispose();
      });
      slot.root.parent?.remove(slot.root);
    }
    slots.length = 0;
  }

  return { group, update, dispose };
}
