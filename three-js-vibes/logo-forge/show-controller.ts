import gsap from "gsap";
import * as THREE from "three";

import type { SportMesh } from "./mesh-builders";

/**
 * Drives the cycle: only one mesh is on stage at a time. When the cycle
 * advances, the previous mesh tweens to opacity 0 + scale 0.4 while the next
 * mesh tweens from scale 0.4 → 1 with a back-out overshoot, plus the rim
 * point-light color crossfades from one sport's tint to the next.
 *
 * Every tween here is GSAP-driven so they're cheap, retargetable, and play
 * well with `setReducedMotion` killing them.
 */

export interface ShowFrame {
  sportMesh: SportMesh;
  name: string;
  caption: string;
  /** Hex color used to tint the rim point-light when this frame is active. */
  rimColor: string;
}

export interface ShowController {
  /** Kick off the cycle. Call once after the first frame is set up. */
  start(): void;
  /** Skip ahead. */
  next(): void;
  /** Per-frame tick: spin the active mesh. */
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
  /** Total crossfade duration (out + in overlap inside this window). */
  fadeSeconds?: number;
}

const TMP_FROM = new THREE.Color();
const TMP_TO = new THREE.Color();

export function createShowController(
  opts: ShowControllerOptions,
): ShowController {
  const { frames, rimLight, holdSeconds = 3.4, fadeSeconds = 1.0 } = opts;

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
    const mat = f.sportMesh.mesh.material as THREE.MeshStandardMaterial;
    if (i === 0) {
      mat.opacity = 1;
      f.sportMesh.mesh.scale.setScalar(1);
      f.sportMesh.mesh.visible = true;
    } else {
      mat.opacity = 0;
      f.sportMesh.mesh.scale.setScalar(0.4);
      f.sportMesh.mesh.visible = false;
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

    next.sportMesh.mesh.visible = true;
    const prevMat = prev.sportMesh.mesh.material as THREE.MeshStandardMaterial;
    const nextMat = next.sportMesh.mesh.material as THREE.MeshStandardMaterial;

    track(
      gsap.to(prevMat, {
        opacity: 0,
        duration: fadeSeconds * 0.7,
        ease: "power2.in",
      }),
    );
    track(
      gsap.to(prev.sportMesh.mesh.scale, {
        x: 0.4,
        y: 0.4,
        z: 0.4,
        duration: fadeSeconds * 0.7,
        ease: "power2.in",
        onComplete: () => {
          prev.sportMesh.mesh.visible = false;
        },
      }),
    );

    track(
      gsap.to(nextMat, {
        opacity: 1,
        duration: fadeSeconds,
        delay: fadeSeconds * 0.4,
        ease: "power2.out",
      }),
    );
    track(
      gsap.fromTo(
        next.sportMesh.mesh.scale,
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

    // Crossfade the rim light color in step with the mesh swap. We tween a
    // throwaway color object's channels and copy them onto the light each
    // frame to avoid GSAP touching read-only THREE.Color setters directly.
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
      // Spin every mesh that's currently visible (during the crossfade window
      // both prev and next can be visible at once, so we spin all visible
      // ones instead of just the "current").
      for (const f of frames) {
        if (!f.sportMesh.mesh.visible) continue;
        const ax = f.sportMesh.spinAxis;
        f.sportMesh.mesh.rotation[ax] += f.sportMesh.spinSpeed * deltaSeconds;
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
