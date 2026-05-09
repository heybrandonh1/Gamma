import gsap from "gsap";
import * as THREE from "three";

import type { SportMesh } from "./mesh-builders";

/**
 * Drives the cycle: only one mesh is on stage at a time. When the cycle
 * advances, the previous mesh tweens to opacity 0 + scale 0.4 while the next
 * mesh tweens from scale 0.4 → 1 with a back-out overshoot, plus the rim
 * point-light color crossfades from one sport's tint to the next.
 *
 * Opacity is driven through `SportMesh.setOpacity(value)` rather than tweening
 * a single material — sport meshes are now `Group`s with multiple sub-meshes
 * (baseball + stitch tubes, soccer ball with multi-material panels, etc.), so
 * the controller pokes a state object and the mesh's helper applies it to
 * every material in its tree.
 */

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
    throw new Error("logo-forge: at least one frame is required");
  }

  let reduced = false;
  let disposed = false;
  let currentIndex = 0;
  let scheduled: gsap.core.Tween | null = null;
  const subscribers = new Set<(index: number, frame: ShowFrame) => void>();
  const liveTweens = new Set<gsap.core.Tween>();

  // Initial pose: frame 0 visible at full scale, others tucked away.
  frames.forEach((f, i) => {
    if (i === 0) {
      f.sportMesh.setOpacity(1);
      f.sportMesh.object.scale.setScalar(1);
      f.sportMesh.object.visible = true;
    } else {
      f.sportMesh.setOpacity(0);
      f.sportMesh.object.scale.setScalar(0.4);
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

  function fadeTo(nextIndex: number) {
    if (disposed || nextIndex === currentIndex) return;
    const prev = frames[currentIndex];
    const next = frames[nextIndex];

    next.sportMesh.object.visible = true;

    // Fade out previous: opacity → 0, scale → 0.4
    const prevOpacity = { v: 1 };
    track(
      gsap.to(prevOpacity, {
        v: 0,
        duration: fadeSeconds * 0.7,
        ease: "power2.in",
        onUpdate: () => prev.sportMesh.setOpacity(prevOpacity.v),
      }),
    );
    track(
      gsap.to(prev.sportMesh.object.scale, {
        x: 0.4,
        y: 0.4,
        z: 0.4,
        duration: fadeSeconds * 0.7,
        ease: "power2.in",
        onComplete: () => {
          prev.sportMesh.object.visible = false;
        },
      }),
    );

    // Fade in next: opacity 0 → 1, scale 0.4 → 1 with overshoot
    next.sportMesh.setOpacity(0);
    const nextOpacity = { v: 0 };
    track(
      gsap.to(nextOpacity, {
        v: 1,
        duration: fadeSeconds,
        delay: fadeSeconds * 0.4,
        ease: "power2.out",
        onUpdate: () => next.sportMesh.setOpacity(nextOpacity.v),
      }),
    );
    track(
      gsap.fromTo(
        next.sportMesh.object.scale,
        { x: 0.4, y: 0.4, z: 0.4 },
        {
          x: 1,
          y: 1,
          z: 1,
          duration: fadeSeconds,
          delay: fadeSeconds * 0.4,
          ease: "back.out(1.5)",
          onComplete: () => {
            currentIndex = nextIndex;
            notify(currentIndex);
            schedule();
          },
        },
      ),
    );

    // Crossfade the rim light tint in lockstep.
    TMP_FROM.set(prev.rimColor);
    TMP_TO.set(next.rimColor);
    const colorState = { r: TMP_FROM.r, g: TMP_FROM.g, b: TMP_FROM.b };
    track(
      gsap.to(colorState, {
        r: TMP_TO.r,
        g: TMP_TO.g,
        b: TMP_TO.b,
        duration: fadeSeconds,
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
      fadeTo(next);
    }) as unknown as gsap.core.Tween;
  }

  return {
    start() {
      notify(currentIndex);
      schedule();
    },
    next() {
      const ni = (currentIndex + 1) % frames.length;
      fadeTo(ni);
    },
    update(deltaSeconds: number) {
      // Spin every visible mesh on its own axis. During the crossfade window
      // both prev and next can be visible; spinning both keeps the motion
      // continuous through the transition.
      for (const f of frames) {
        if (!f.sportMesh.object.visible) continue;
        const ax = f.sportMesh.spinAxis;
        f.sportMesh.object.rotation[ax] += f.sportMesh.spinSpeed * deltaSeconds;
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
