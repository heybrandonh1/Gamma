import gsap from "gsap";
import * as THREE from "three";

import type { SportMesh } from "./mesh-builders";

/**
 * Drives the cycle as a vibration-and-spring morph: both meshes are visible
 * through the entire transition, both wobble intensely via the per-vertex
 * jiggle shader (the same one that powers click-to-jello), and a softened
 * squash carries the silhouette change from one shape to the next.
 *
 *   1. At morph start, both meshes are visible. The outgoing mesh stays at
 *      its neutral pose; the incoming mesh starts from a softened "puddle"
 *      pose (much less flat than before — extreme flatten was hiding the
 *      vibration) and immediately gets a powerful jiggle poke. The outgoing
 *      mesh gets a poke of its own at a different surface point so the two
 *      shake out of sync.
 *   2. Outgoing mesh's opacity fades to zero while it wobbles in place; no
 *      scale change on the way out — the wobble itself is the visible
 *      transformation.
 *   3. Incoming mesh's opacity fades up while still in the squashed pose,
 *      then springs back to neutral with `elastic.out` overshoot. Halfway
 *      through the spring it gets a second, even louder poke that lands as
 *      it pops to full size — the impact "splat" of the new ball arriving.
 *
 * The vibration is what carries the morph feel. Two different shapes both
 * trembling on the same spot reads as one mass changing form, not as two
 * separate objects swapping. The rim point-light tint crossfades in
 * lockstep so the lighting "morphs" too.
 *
 * Opacity is driven through `SportMesh.setOpacity(value)` rather than
 * tweening a single material — sport meshes are `Group`s with multiple
 * sub-meshes (baseball + stitch tubes, soccer ball with multi-material
 * panels, etc.), so the controller pokes a state object and the mesh's
 * helper applies it to every material in its tree.
 */

// "Puddle" pose used as the incoming mesh's starting scale. Non-uniform:
// flatter on Y, wider on XZ, like a jelly blob. Much softer than the
// original (0.18 / 1.55) so the wobble shader's per-vertex displacement is
// still visible on the squashed shape — the previous extreme flatten made
// the body too thin for the jiggle to register as anything but a flicker.
const PUDDLE_Y = 0.55;
const PUDDLE_XZ = 1.25;

// Wobble amplitudes for the morph. The click handler passes nothing
// (defaults to the click intensity ~0.22). Morph wobbles are louder so the
// transition reads as energetic rather than incidental, and the second
// poke ("splat") is the loudest because the ball is also popping out of
// the puddle pose at that moment — wobble + spring overshoot together
// give the satisfying impact.
const MORPH_WOBBLE_AMP = 0.28;
const MORPH_SPLAT_AMP = 0.36;

// Reusable scratch vector so we don't allocate one per morph for the
// random wobble center.
const TMP_WOBBLE_CENTER = new THREE.Vector3();
function randomWobbleCenter(): THREE.Vector3 {
  // Pick a point inside a unit cube around the origin; the shader's
  // exp(-dist · 0.55) falloff means anywhere inside ~unit radius gives a
  // strong full-body wobble, just with a slightly different epicenter
  // each morph so the vibration looks fresh rather than mechanical.
  return TMP_WOBBLE_CENTER.set(
    (Math.random() - 0.5) * 0.8,
    (Math.random() - 0.5) * 0.8,
    (Math.random() - 0.5) * 0.8,
  );
}

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

    // Both meshes are visible through the entire morph window so the eye
    // tracks one wobbling shape changing form, not one popping out and
    // another popping in. Incoming mesh starts in the softened puddle
    // pose at zero opacity.
    next.sportMesh.object.visible = true;
    next.sportMesh.setOpacity(0);
    next.sportMesh.object.scale.set(PUDDLE_XZ, PUDDLE_Y, PUDDLE_XZ);

    // Initial wobble pokes — both meshes shake at different epicenters so
    // the vibration looks like one mass tearing itself open into the next
    // shape. Outgoing keeps its neutral scale; the wobble alone carries
    // the visible "I'm leaving" energy. Incoming wobbles inside the
    // puddle pose so the squash itself appears to vibrate.
    prev.sportMesh.poke(randomWobbleCenter(), MORPH_WOBBLE_AMP);
    next.sportMesh.poke(randomWobbleCenter(), MORPH_WOBBLE_AMP);

    // Phase 1 — outgoing mesh fades opacity to zero while wobbling in
    // place. No scale change on the way out: the previous design squashed
    // the outgoing mesh into a flat puddle which masked the vibration
    // entirely; keeping it at neutral scale lets the wobble do its job.
    const fadeOutDur = fadeSeconds * 0.55;
    const prevOpacity = { v: 1 };
    track(
      gsap.to(prevOpacity, {
        v: 0,
        duration: fadeOutDur,
        ease: "power2.in",
        onUpdate: () => prev.sportMesh.setOpacity(prevOpacity.v),
        onComplete: () => {
          prev.sportMesh.object.visible = false;
          prev.sportMesh.object.scale.set(1, 1, 1);
        },
      }),
    );

    // Phase 2 — incoming mesh ramps up its opacity while still squashed,
    // overlapping the outgoing fade so both are visible (and both
    // wobbling) at the morph midpoint.
    const overlapStart = fadeOutDur * 0.4;
    const fadeInDur = fadeSeconds * 0.55;
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
    // Slightly more aggressive elastic config than the previous design
    // (amplitude 1.05, period 0.45) for a louder bounce.
    const reboundDur = fadeSeconds * 1.1;
    const reboundDelay = fadeOutDur * 0.5;
    track(
      gsap.to(next.sportMesh.object.scale, {
        x: 1,
        y: 1,
        z: 1,
        duration: reboundDur,
        delay: reboundDelay,
        ease: "elastic.out(1.05, 0.45)",
        onComplete: () => {
          currentIndex = nextIndex;
          notify(currentIndex);
          schedule();
        },
      }),
    );

    // Phase 4 — re-poke the incoming mesh just as it pops to full size.
    // Wobble + spring overshoot landing simultaneously gives the morph
    // its "splat" impact moment, which is what makes the transition feel
    // alive instead of just two crossfading shapes.
    track(
      gsap.delayedCall(reboundDelay + reboundDur * 0.25, () => {
        if (disposed) return;
        next.sportMesh.poke(randomWobbleCenter(), MORPH_SPLAT_AMP);
      }) as unknown as gsap.core.Tween,
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
        duration: fadeOutDur + fadeInDur,
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
