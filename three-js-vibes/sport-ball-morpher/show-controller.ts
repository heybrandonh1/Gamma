import gsap from "gsap";
import * as THREE from "three";

import type { SportSpec } from "./sport-specs";
import type { UnifiedSportBody } from "./unified-body";

/**
 * Drives the cycle on the {@link UnifiedSportBody}.
 *
 * The body is a single mesh whose vertex positions and colors are a
 * smoothstep blend between two slots, A (current) and B (next). The
 * controller's job is the simplest version of an animation loop:
 *
 *   1. Hold at slot A's rest pose for `holdSeconds`.
 *   2. Tween `uBlend: 0 → 1` over `morphSeconds`. The body's silhouette
 *      and color smoothly interpolate from sport A's data to sport B's
 *      data — both per-vertex channels morph in lockstep so the eye
 *      sees one mass molding into the next, not a crossfade.
 *   3. On completion, ask the body to promote slot B into slot A and
 *      load sport (current+2) into the new slot B. `uBlend` resets to 0.
 *   4. Loop.
 *
 * There is no opacity crossfade, no overlapping mesh pair, no separate
 * decoration fade — the morph is the entire transition. Everything the
 * eye sees on the body (silhouette, base color, stitches, panels, lace
 * strip, rim band, roughness, metalness, env-map intensity) lives in
 * the per-vertex / per-uniform blend.
 *
 * The rim point-light tints alongside via `body.blendedRimColor` so the
 * scene lighting morphs with the geometry.
 */

const MORPH_SPLAT_AMP = 0.34;

const TMP_WOBBLE_CENTER = new THREE.Vector3();
function randomWobbleCenter(): THREE.Vector3 {
  return TMP_WOBBLE_CENTER.set(
    (Math.random() - 0.5) * 0.8,
    (Math.random() - 0.5) * 0.8,
    (Math.random() - 0.5) * 0.8,
  );
}

export interface ShowController {
  start(): void;
  next(): void;
  update(deltaSeconds: number): void;
  setReducedMotion(reduced: boolean): void;
  onFrameSettled(cb: (index: number, sport: SportSpec) => void): () => void;
  /** Trigger a click-to-jello impulse wobble centered at `localPoint`. */
  poke(localPoint: THREE.Vector3, amp?: number): void;
  /**
   * Hold a hover-sustain wave centered at `localPoint`. Call every
   * animation frame the cursor is over the body — the body smoothly
   * ramps the wobble up and keeps it pinned at the hover amplitude
   * until {@link releaseHover} runs.
   */
  hold(localPoint: THREE.Vector3): void;
  /** Release the hover hold; the wave resumes its natural decay. */
  releaseHover(): void;
  /**
   * Current "incoming" sport's index — what slot B holds. The host
   * component uses this to compute the actual morphed surface point
   * for click raycasts.
   */
  currentBlend(): { blend: number; slotA: number; slotB: number };
  dispose(): void;
}

export interface ShowControllerOptions {
  body: UnifiedSportBody;
  sports: SportSpec[];
  rimLight: THREE.PointLight;
  /** Seconds the body holds at rest before morphing to the next sport. */
  holdSeconds?: number;
  /** Total morph duration. */
  morphSeconds?: number;
}

const TMP_RIM_COLOR = new THREE.Color();

export function createShowController(
  opts: ShowControllerOptions,
): ShowController {
  const {
    body,
    sports,
    rimLight,
    holdSeconds = 2.4,
    morphSeconds = 1.8,
  } = opts;

  if (sports.length < 2) {
    throw new Error("sport-ball-morpher: at least two sports are required");
  }

  let reduced = false;
  let disposed = false;
  // The body starts initialised at slot A = sport 0, slot B = sport 1.
  let slotA = 0;
  let slotB = 1;
  let blend = 0;
  let scheduled: gsap.core.Tween | null = null;
  let activeTween: gsap.core.Tween | null = null;
  const subscribers = new Set<(index: number, sport: SportSpec) => void>();

  rimLight.color.set(sports[slotA].rimColor);

  function notifyAtRest() {
    subscribers.forEach((cb) => cb(slotA, sports[slotA]));
  }

  function morphTo(nextIndex: number) {
    if (disposed) return;

    const morphState = { t: 0 };
    activeTween = gsap.to(morphState, {
      t: 1,
      duration: morphSeconds,
      ease: "power2.inOut",
      onUpdate: () => {
        blend = morphState.t;
        body.setBlend(blend);
        body.blendedRimColor(TMP_RIM_COLOR);
        rimLight.color.copy(TMP_RIM_COLOR);
      },
      onComplete: () => {
        if (disposed) return;
        // Promote slot B into slot A and load the *new* next sport
        // (`nextIndex`) into slot B. After this call, the body is at
        // its rest pose for the new "current" sport, and `uBlend = 0`.
        body.cycleAndLoad(nextIndex);
        slotA = slotB;
        slotB = nextIndex;
        blend = 0;
        rimLight.color.set(sports[slotA].rimColor);
        notifyAtRest();
        // A small splat poke as the new sport "lands" — the wave decay
        // is short enough that it doesn't overlap the next morph,
        // and the ripple gives a satisfying arrival feel.
        body.poke(randomWobbleCenter(), MORPH_SPLAT_AMP);
        scheduleNext();
      },
    });
  }

  function scheduleNext() {
    if (reduced || disposed) return;
    scheduled?.kill();
    scheduled = gsap.delayedCall(holdSeconds, () => {
      if (disposed || reduced) return;
      // Slot A is the *current* sport. Slot B is already the next; we
      // tween `uBlend` from 0 to 1 to morph from A into B, and once
      // the morph completes we ask the body to promote and load the
      // following sport into slot B.
      const nextNextIndex = (slotB + 1) % sports.length;
      morphTo(nextNextIndex);
    }) as unknown as gsap.core.Tween;
  }

  return {
    start() {
      notifyAtRest();
      scheduleNext();
    },
    next() {
      const nextNextIndex = (slotB + 1) % sports.length;
      morphTo(nextNextIndex);
    },
    poke(localPoint, amp) {
      if (disposed) return;
      body.poke(localPoint, amp);
    },
    hold(localPoint) {
      if (disposed) return;
      body.setHover(localPoint);
    },
    releaseHover() {
      if (disposed) return;
      body.clearHover();
    },
    update(deltaSeconds: number) {
      const axis = body.currentSpinAxis();
      const speed = body.currentSpinSpeed();
      body.object.rotation[axis] += speed * deltaSeconds;
      body.tick(deltaSeconds);
    },
    setReducedMotion(v: boolean) {
      reduced = v;
      if (v) {
        scheduled?.kill();
        scheduled = null;
        activeTween?.kill();
        activeTween = null;
      } else {
        scheduleNext();
      }
    },
    onFrameSettled(cb) {
      subscribers.add(cb);
      return () => subscribers.delete(cb);
    },
    currentBlend() {
      return { blend, slotA, slotB };
    },
    dispose() {
      disposed = true;
      scheduled?.kill();
      scheduled = null;
      activeTween?.kill();
      activeTween = null;
      subscribers.clear();
    },
  };
}
