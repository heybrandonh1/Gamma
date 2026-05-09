import gsap from "gsap";
import * as THREE from "three";

import type { SportMesh } from "./mesh-builders";

/**
 * Drives the cycle as a jelly-style squash/stretch morph rather than a plain
 * fade-out / fade-in. When the cycle advances:
 *
 *   1. The outgoing mesh squishes into a shared "puddle" pose — a flat,
 *      non-uniform scale of `(PUDDLE_XZ, PUDDLE_Y, PUDDLE_XZ)` — using a
 *      `power3.in` ease, while opacity crossfades down toward zero.
 *   2. The incoming mesh starts from that same puddle pose at opacity 0,
 *      ramps opacity up while still squashed, then springs back to its
 *      neutral scale `(1, 1, 1)` with `elastic.out` easing so it overshoots
 *      and wobbles into shape like a blob of jelly.
 *
 * Both meshes are visible during the morph window — they share the puddle
 * pose at the midpoint — so the transition reads as one shape squishing
 * into the next rather than one disappearing and another appearing. The
 * rim point-light tint crossfades in lockstep so the lighting "morphs" too.
 *
 * Opacity is driven through `SportMesh.setOpacity(value)` rather than tweening
 * a single material — sport meshes are `Group`s with multiple sub-meshes
 * (baseball + stitch tubes, soccer ball with multi-material panels, etc.), so
 * the controller pokes a state object and the mesh's helper applies it to
 * every material in its tree.
 */

// "Puddle" pose used as the shared midpoint of every morph. Non-uniform:
// the mesh is squashed flat along Y (height) and slightly bulged along XZ
// (width / depth) to read as a jiggly splat. Picking values that aren't too
// extreme keeps the bat and the puck readable mid-morph.
const PUDDLE_Y = 0.18;
const PUDDLE_XZ = 1.55;

export interface ShowFrame {
  sportMesh: SportMesh;
  name: string;
  caption: string;
  /** Hex color used to tint the rim point-light when this frame is active. */
  rimColor: string;
}

export interface ShowController {
  start(): void;
  next(): void;
  update(deltaSeconds: number): void;
  setReducedMotion(reduced: boolean): void;
  onFrameSettled(cb: (index: number, frame: ShowFrame) => void): () => void;
  /**
   * Trigger a click-to-jello wobble on the currently active mesh, centered
   * at `localPoint` (a point in that mesh's local coordinate space).
   * Returns the active frame's mesh so the caller can do further work
   * (e.g. logging) if desired.
   */
  poke(localPoint: THREE.Vector3): void;
  dispose(): void;
}

export interface ShowControllerOptions {
  frames: ShowFrame[];
  rimLight: THREE.PointLight;
  /** Seconds the active mesh holds before crossfading to the next. */
  holdSeconds?: number;
  /** Total crossfade duration. */
  fadeSeconds?: number;
}

const TMP_FROM = new THREE.Color();
const TMP_TO = new THREE.Color();

export function createShowController(
  opts: ShowControllerOptions,
): ShowController {
  const { frames, rimLight, holdSeconds = 3.6, fadeSeconds = 1.0 } = opts;

  if (frames.length === 0) {
    throw new Error("sport-ball-morpher: at least one frame is required");
  }

  let reduced = false;
  let disposed = false;
  let currentIndex = 0;
  let scheduled: gsap.core.Tween | null = null;
  const subscribers = new Set<(index: number, frame: ShowFrame) => void>();
  const liveTweens = new Set<gsap.core.Tween>();

  // Initial pose: frame 0 visible at full scale, others sitting in the
  // puddle pose (squashed + invisible) so the very first morph picks them
  // up from the same shared midpoint every other frame is morphed through.
  frames.forEach((f, i) => {
    if (i === 0) {
      f.sportMesh.setOpacity(1);
      f.sportMesh.object.scale.set(1, 1, 1);
      f.sportMesh.object.visible = true;
    } else {
      f.sportMesh.setOpacity(0);
      f.sportMesh.object.scale.set(PUDDLE_XZ, PUDDLE_Y, PUDDLE_XZ);
      f.sportMesh.object.visible = false;
    }
  });
  rimLight.color.set(frames[0].rimColor);

  function notify(index: number) {
    subscribers.forEach((cb) => cb(index, frames[index]));
  }

  function track(t: gsap.core.Tween) {
    liveTweens.add(t);
    return t;
  }

  function morphTo(nextIndex: number) {
    if (disposed || nextIndex === currentIndex) return;
    const prev = frames[currentIndex];
    const next = frames[nextIndex];

    // Both meshes are visible through the morph window so the eye tracks
    // a single squishy shape transforming, not one popping out and another
    // popping in.
    next.sportMesh.object.visible = true;
    next.sportMesh.setOpacity(0);
    next.sportMesh.object.scale.set(PUDDLE_XZ, PUDDLE_Y, PUDDLE_XZ);

    // Phase 1 — outgoing mesh squishes from neutral into the puddle pose,
    // opacity crossfades down so by the time it's hit puddle it's mostly
    // gone (but not before — the squash is the visible part of the exit).
    const squashDur = fadeSeconds * 0.55;
    track(
      gsap.to(prev.sportMesh.object.scale, {
        x: PUDDLE_XZ,
        y: PUDDLE_Y,
        z: PUDDLE_XZ,
        duration: squashDur,
        ease: "power3.in",
      }),
    );
    const prevOpacity = { v: 1 };
    track(
      gsap.to(prevOpacity, {
        v: 0,
        duration: squashDur,
        ease: "power2.in",
        onUpdate: () => prev.sportMesh.setOpacity(prevOpacity.v),
        onComplete: () => {
          prev.sportMesh.object.visible = false;
          prev.sportMesh.object.scale.set(1, 1, 1);
        },
      }),
    );

    // Phase 2 — incoming mesh ramps up its opacity while still in the puddle
    // pose, so the shared squashed silhouette is what the eye registers as
    // the morph midpoint.
    const overlapStart = squashDur * 0.55;
    const fadeInDur = squashDur * 0.65;
    const nextOpacity = { v: 0 };
    track(
      gsap.to(nextOpacity, {
        v: 1,
        duration: fadeInDur,
        delay: overlapStart,
        ease: "power2.out",
        onUpdate: () => next.sportMesh.setOpacity(nextOpacity.v),
      }),
    );

    // Phase 3 — incoming mesh springs out of the puddle back to (1, 1, 1)
    // with elastic.out so it overshoots both the height and the width and
    // wobbles into its neutral pose like a blob of jelly snapping back.
    const reboundDur = fadeSeconds * 1.1;
    track(
      gsap.to(next.sportMesh.object.scale, {
        x: 1,
        y: 1,
        z: 1,
        duration: reboundDur,
        delay: squashDur,
        ease: "elastic.out(1, 0.55)",
        onComplete: () => {
          currentIndex = nextIndex;
          notify(currentIndex);
          schedule();
        },
      }),
    );

    // Crossfade the rim light tint across the full morph window so the
    // lighting morphs alongside the geometry.
    TMP_FROM.set(prev.rimColor);
    TMP_TO.set(next.rimColor);
    const colorState = { r: TMP_FROM.r, g: TMP_FROM.g, b: TMP_FROM.b };
    track(
      gsap.to(colorState, {
        r: TMP_TO.r,
        g: TMP_TO.g,
        b: TMP_TO.b,
        duration: squashDur + fadeInDur,
        ease: "power2.inOut",
        onUpdate: () => {
          rimLight.color.setRGB(colorState.r, colorState.g, colorState.b);
        },
      }),
    );
  }

  function schedule() {
    if (reduced || disposed) return;
    scheduled?.kill();
    scheduled = gsap.delayedCall(holdSeconds, () => {
      if (disposed || reduced) return;
      const next = (currentIndex + 1) % frames.length;
      morphTo(next);
    }) as unknown as gsap.core.Tween;
  }

  return {
    start() {
      notify(currentIndex);
      schedule();
    },
    next() {
      const ni = (currentIndex + 1) % frames.length;
      morphTo(ni);
    },
    poke(localPoint) {
      if (disposed) return;
      frames[currentIndex].sportMesh.poke(localPoint);
    },
    update(deltaSeconds: number) {
      // Spin every visible mesh on its own axis. During the crossfade window
      // both prev and next can be visible; spinning both keeps the motion
      // continuous through the transition. Also advance any in-flight
      // click-to-jello wobble so the wave decays at the same rate the
      // shader is reading it at.
      for (const f of frames) {
        if (!f.sportMesh.object.visible) continue;
        const ax = f.sportMesh.spinAxis;
        f.sportMesh.object.rotation[ax] += f.sportMesh.spinSpeed * deltaSeconds;
        f.sportMesh.tickJiggle(deltaSeconds);
      }
    },
    setReducedMotion(v: boolean) {
      reduced = v;
      if (v) {
        scheduled?.kill();
        scheduled = null;
      } else {
        schedule();
      }
    },
    onFrameSettled(cb) {
      subscribers.add(cb);
      return () => subscribers.delete(cb);
    },
    dispose() {
      disposed = true;
      scheduled?.kill();
      scheduled = null;
      liveTweens.forEach((t) => t.kill());
      liveTweens.clear();
      subscribers.clear();
    },
  };
}
