import gsap from "gsap";
import * as THREE from "three";

import type { SportMesh } from "./mesh-builders";

/**
 * Drives the cycle as a true silhouette-level morph.
 *
 *   1. The OUTGOING mesh has its `aTargetDist` set from the INCOMING
 *      mesh's `surfaceDist`, so its vertices know where to deform to.
 *   2. The INCOMING mesh has its `aTargetDist` set from the OUTGOING
 *      mesh's `surfaceDist`, so its vertices start posed in the OUTGOING
 *      sport's silhouette.
 *   3. We tween a shared progress value `t: 0 → 1` over the morph window:
 *        - outgoing.uMorphT  = t       (rest A → B silhouette)
 *        - incoming.uMorphT  = 1 - t   (A silhouette → rest B)
 *        - outgoing.bodyOpacity = 1 - t
 *        - incoming.bodyOpacity = t
 *
 * Because both meshes use the same pair of `surfaceDist` functions, their
 * silhouettes coincide at every value of `t` (`mix(A, B, t) ≡ mix(A, B,
 * t)`). The opacity crossfade is therefore visually a no-op for the
 * silhouette — the eye sees one continuously molding shape with the color
 * fading from sport A to sport B. There is no puddle pose, no scale
 * spring, and no moment where either body is invisible while the other
 * hasn't taken over.
 *
 * Decoration meshes that don't participate in the silhouette morph
 * (currently just the baseball's instanced cross-stitches) are faded out
 * very early in the morph window and faded back in for the new sport at
 * the very end, so the eye never sees a stitch-on-football kind of
 * mismatch. Body-attached decorations (basketball seams, football laces,
 * hockey puck rim band, soccer ball panels) ride the silhouette morph on
 * the same `aDirection / aRestDist / aTargetDist` attributes the body
 * does, and so deform smoothly with it.
 */

const MORPH_SPLAT_AMP = 0.36;

const TMP_WOBBLE_CENTER = new THREE.Vector3();
function randomWobbleCenter(): THREE.Vector3 {
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
   */
  poke(localPoint: THREE.Vector3): void;
  dispose(): void;
}

export interface ShowControllerOptions {
  frames: ShowFrame[];
  rimLight: THREE.PointLight;
  /** Seconds the active mesh holds at rest before morphing to the next. */
  holdSeconds?: number;
  /** Total morph duration. */
  morphSeconds?: number;
}

const TMP_FROM = new THREE.Color();
const TMP_TO = new THREE.Color();

export function createShowController(
  opts: ShowControllerOptions,
): ShowController {
  const { frames, rimLight, holdSeconds = 3.0, morphSeconds = 1.4 } = opts;

  if (frames.length === 0) {
    throw new Error("sport-ball-morpher: at least one frame is required");
  }

  let reduced = false;
  let disposed = false;
  let currentIndex = 0;
  let scheduled: gsap.core.Tween | null = null;
  const subscribers = new Set<(index: number, frame: ShowFrame) => void>();
  const liveTweens = new Set<gsap.core.Tween>();

  // Initial pose: frame 0 visible at rest, every other frame invisible at
  // rest. No "puddle" pose, no pre-squashed silhouette — the morph itself
  // is what carries the transition energy now.
  frames.forEach((f, i) => {
    if (i === 0) {
      f.sportMesh.setBodyOpacity(1);
      f.sportMesh.setDecorationOpacity(1);
      f.sportMesh.setMorphProgress(0);
      f.sportMesh.object.visible = true;
    } else {
      f.sportMesh.setBodyOpacity(0);
      f.sportMesh.setDecorationOpacity(0);
      f.sportMesh.setMorphProgress(0);
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

    // Wire each mesh's morph target to the *other* sport's surface
    // distance. Both meshes will produce the same silhouette at any given
    // `t` because they share the same pair of distance functions.
    prev.sportMesh.setMorphTarget(next.sportMesh.surfaceDist);
    next.sportMesh.setMorphTarget(prev.sportMesh.surfaceDist);

    // Both meshes are in the scene from the very first frame of the
    // morph: outgoing stays fully opaque underneath while the incoming
    // mesh fades up on top of it. We use this asymmetric crossfade
    // (instead of `outgoing α: 1→0, incoming α: 0→1`) to keep the
    // background from bleeding through — when both meshes are partially
    // transparent at the same pixel, alpha compositing leaks the BG color
    // through any gap; with outgoing pinned at α=1 the back layer is
    // always solid and the incoming layer linearly blends its color over
    // it. Net result: at `t = 0.5` the visible color is exactly
    // `0.5·A + 0.5·B`, which is the clean color-morph the user expects.
    //
    // Render order is forced — both meshes are transparent + don't
    // depth-write, so without an explicit order three.js's transparent
    // sort would break ties on insertion order, which means a wrap-around
    // morph (e.g. last sport → first sport) would draw the incoming
    // BEHIND the outgoing and disappear entirely. `renderOrder` on the
    // incoming Group raises every descendant Mesh in the render list so
    // the incoming layer always paints on top, no matter the cycle
    // direction.
    prev.sportMesh.object.visible = true;
    next.sportMesh.object.visible = true;
    prev.sportMesh.object.renderOrder = 0;
    next.sportMesh.object.renderOrder = 1;
    prev.sportMesh.setMorphProgress(0);
    next.sportMesh.setMorphProgress(1);
    prev.sportMesh.setBodyOpacity(1);
    next.sportMesh.setBodyOpacity(0);
    next.sportMesh.setDecorationOpacity(0);

    // Both silhouettes track the same `t` — `prev.uMorphT = t` and
    // `next.uMorphT = 1 - t` produce identical envelopes at every value
    // of `t`, so the asymmetric opacity crossfade reads as one shape
    // continuously molding from A to B (not A fading out and B fading in
    // separately).
    const morphState = { t: 0 };
    track(
      gsap.to(morphState, {
        t: 1,
        duration: morphSeconds,
        ease: "power2.inOut",
        onUpdate: () => {
          const t = morphState.t;
          prev.sportMesh.setMorphProgress(t);
          next.sportMesh.setMorphProgress(1 - t);
          // Outgoing stays solid the entire morph; incoming fades up on
          // top of it. See the comment above the tween for why this
          // beats a symmetric crossfade.
          next.sportMesh.setBodyOpacity(t);
        },
        onComplete: () => {
          if (disposed) return;
          // Outgoing now hides; incoming takes over fully at rest pose.
          // Resetting both `uMorphT` to 0 makes the rest-pose state
          // canonical regardless of which direction the previous morph
          // travelled. Render order resets too so the next morph in the
          // cycle starts from a clean slate before promoting its own
          // incoming layer.
          prev.sportMesh.setBodyOpacity(0);
          prev.sportMesh.setMorphProgress(0);
          prev.sportMesh.setDecorationOpacity(0);
          prev.sportMesh.object.visible = false;
          prev.sportMesh.object.renderOrder = 0;
          next.sportMesh.setBodyOpacity(1);
          next.sportMesh.setMorphProgress(0);
          next.sportMesh.object.renderOrder = 0;
          currentIndex = nextIndex;
          notify(currentIndex);
          schedule();
        },
      }),
    );

    // Decoration fade-out: only the outgoing's non-morphing decorations
    // (e.g. baseball stitches). Runs against the first ~30% of the morph
    // so the body shape change is what dominates the visual story.
    const prevDecoration = { v: 1 };
    track(
      gsap.to(prevDecoration, {
        v: 0,
        duration: morphSeconds * 0.3,
        ease: "power2.in",
        onUpdate: () => prev.sportMesh.setDecorationOpacity(prevDecoration.v),
      }),
    );

    // Decoration fade-in: incoming's non-morphing decorations land in the
    // last ~30% of the morph, after the body shape has visibly become the
    // new sport.
    const nextDecoration = { v: 0 };
    track(
      gsap.to(nextDecoration, {
        v: 1,
        duration: morphSeconds * 0.3,
        delay: morphSeconds * 0.7,
        ease: "power2.out",
        onUpdate: () => next.sportMesh.setDecorationOpacity(nextDecoration.v),
      }),
    );

    // Crossfade rim light tint across the full morph window so the
    // lighting morphs alongside the geometry.
    TMP_FROM.set(prev.rimColor);
    TMP_TO.set(next.rimColor);
    const colorState = { r: TMP_FROM.r, g: TMP_FROM.g, b: TMP_FROM.b };
    track(
      gsap.to(colorState, {
        r: TMP_TO.r,
        g: TMP_TO.g,
        b: TMP_TO.b,
        duration: morphSeconds,
        ease: "power2.inOut",
        onUpdate: () => {
          rimLight.color.setRGB(colorState.r, colorState.g, colorState.b);
        },
      }),
    );

    // Splat — fire a low-amplitude jello poke on the incoming mesh just as
    // it approaches its rest pose. This used to compensate for the puddle
    // bounce; now it just adds a subtle "thump" of arrival on top of the
    // (already smooth) morph.
    track(
      gsap.delayedCall(morphSeconds * 0.85, () => {
        if (disposed) return;
        next.sportMesh.poke(randomWobbleCenter(), MORPH_SPLAT_AMP);
      }) as unknown as gsap.core.Tween,
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
      // Spin every visible mesh on its own axis. During the morph window
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
