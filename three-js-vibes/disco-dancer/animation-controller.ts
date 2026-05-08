import * as THREE from "three";

/**
 * Drives the dancer between "samba" (default loop) and "break" (a brief
 * burst of higher-energy movement) every ~18-26 seconds.
 *
 * Two execution modes:
 *
 * 1. **FBX mode** — when `breakAction` is provided, the controller crossfades
 *    between two AnimationActions on the same mixer. This is the "ideal" path
 *    and works because Mixamo rigs share bone names: a breakdance clip
 *    extracted from a different Mixamo FBX plays cleanly on the samba mesh.
 *
 * 2. **Procedural mode** — when no second clip is supplied, "break" is faked
 *    by spiking the samba `timeScale` and applying a transient root spin /
 *    bounce / forward tilt to the FBX root. Visually reads as "the dancer
 *    goes off for a few seconds" without needing a redistributable Mixamo
 *    file (Adobe TOS forbids redistribution; see the README).
 */

const BREAK_DURATION_MS = 4500;
const FADE_MS = 600;
const SAMBA_MIN_GAP_MS = 18000;
const SAMBA_MAX_GAP_MS = 26000;

type Mode = "samba" | "break";

export interface AnimationControllerOptions {
  /** The FBX root for the dancer (used as the procedural target). */
  root: THREE.Object3D;
  /** Required samba action (already on a mixer, already `.play()`-ed). */
  sambaAction: THREE.AnimationAction;
  /** Optional breakdance action — same mixer, shared rig. */
  breakAction?: THREE.AnimationAction | null;
}

export interface AnimationController {
  /** Call from the render loop. `now` is `performance.now()`. */
  update(now: number): void;
  /** Pause the swap timer and freeze the dancer in samba mode. */
  setReducedMotion(reduced: boolean): void;
  /** Clear the swap timer; safe to call multiple times. */
  dispose(): void;
}

export function createAnimationController(
  opts: AnimationControllerOptions,
): AnimationController {
  const { root, sambaAction, breakAction } = opts;

  let mode: Mode = "samba";
  let modeStarted = performance.now();
  let nextSwapAt = modeStarted + randBetween(SAMBA_MIN_GAP_MS, SAMBA_MAX_GAP_MS);
  let reduced = false;
  let disposed = false;

  // Procedural overlay state — only matters when breakAction is null.
  // Captured at break-start so we can fully restore on break-end.
  let savedTimeScale = sambaAction.timeScale || 1;
  const savedRotY = root.rotation.y;
  const savedRotX = root.rotation.x;

  function startBreak(now: number) {
    mode = "break";
    modeStarted = now;
    nextSwapAt = now + BREAK_DURATION_MS;

    if (breakAction) {
      // FBX crossfade.
      breakAction.reset();
      breakAction.setLoop(THREE.LoopRepeat, Infinity);
      breakAction.play();
      sambaAction.crossFadeTo(breakAction, FADE_MS / 1000, true);
    } else {
      // Procedural: speed up + spin + bounce + forward tilt.
      savedTimeScale = sambaAction.timeScale || 1;
      sambaAction.timeScale = 1.6;
    }
  }

  function startSamba(now: number) {
    mode = "samba";
    modeStarted = now;
    nextSwapAt = now + randBetween(SAMBA_MIN_GAP_MS, SAMBA_MAX_GAP_MS);

    if (breakAction) {
      sambaAction.reset().play();
      breakAction.crossFadeTo(sambaAction, FADE_MS / 1000, true);
    } else {
      sambaAction.timeScale = savedTimeScale;
      // Smoothly unwind procedural rotation during the next ticks; just snap
      // back the X tilt now (Y drift is unwound by `update()` while in samba).
      root.rotation.x = savedRotX;
    }
  }

  function update(now: number) {
    if (disposed || reduced) return;

    if (now >= nextSwapAt) {
      if (mode === "samba") startBreak(now);
      else startSamba(now);
    }

    // Procedural overlay only runs when no break clip is wired.
    if (breakAction) return;

    if (mode === "break") {
      const elapsed = (now - modeStarted) / 1000;
      const burst = Math.min(1, elapsed / 0.35) * Math.min(
        1,
        (BREAK_DURATION_MS / 1000 - elapsed) / 0.35,
      );

      // Spin: gentle continuous Y rotation while the burst is active.
      root.rotation.y += 0.05 * burst;

      // Forward tilt: lean into the move at peak burst.
      root.rotation.x = savedRotX + 0.2 * burst;
    } else {
      // Slowly unwind any residual rotation while in samba mode.
      root.rotation.y = THREE.MathUtils.lerp(root.rotation.y, savedRotY, 0.02);
      root.rotation.x = THREE.MathUtils.lerp(root.rotation.x, savedRotX, 0.05);
    }
  }

  function setReducedMotion(value: boolean) {
    reduced = value;
    if (reduced && mode === "break") {
      // Snap back to samba immediately; reduced-motion users shouldn't see
      // the more energetic state at all.
      if (breakAction) {
        sambaAction.reset().play();
        breakAction.fadeOut(0.2);
      } else {
        sambaAction.timeScale = savedTimeScale;
        root.rotation.x = savedRotX;
      }
      mode = "samba";
    }
  }

  function dispose() {
    disposed = true;
  }

  return { update, setReducedMotion, dispose };
}

function randBetween(a: number, b: number): number {
  return a + Math.random() * (b - a);
}

/**
 * Pick the longest-running clip on an FBX as the "primary" animation. Mixamo
 * usually exports a single clip, but some rigs include a T-pose; this picks
 * the one that's actually a dance.
 */
export function pickPrimaryClip(
  clips: THREE.AnimationClip[],
): THREE.AnimationClip | null {
  if (!clips.length) return null;
  return clips.reduce((best, c) => (c.duration > best.duration ? c : best), clips[0]);
}
