import * as THREE from "three";

/**
 * Click-to-jello + hover-water deformation uniforms + helpers.
 *
 * The actual GLSL for the wobble lives in
 * [unified-body.ts](./unified-body.ts) alongside the silhouette morph
 * term — both layer onto the same `MeshStandardMaterial` vertex stage
 * and are spliced in by a single `onBeforeCompile` hook so the
 * injection seam stays stable across three.js minor versions.
 *
 * The wobble has two trigger modes:
 *
 *   1. **Click impulse** — {@link pokeJiggle} sets the amplitude to
 *      its peak and lets {@link tickJiggle} decay it exponentially
 *      over ~1.5 seconds. The wave time keeps advancing the whole
 *      time so the ripple animates as it dies down.
 *
 *   2. **Hover sustain** — {@link sustainJiggle} pins the amplitude
 *      to a "water-flow" hold value, smoothly ramps up to it over a
 *      few frames if the body was idle, and continuously updates the
 *      wave center as the cursor moves over the surface. The shader
 *      keeps emitting fresh ripples at full strength until the host
 *      stops calling sustain (the user moved the cursor off the
 *      body), at which point {@link tickJiggle} takes back over and
 *      the wave decays naturally.
 *
 * Crucially, the shader's wave displacement is `uJiggleAmp · radial ·
 * wave` — there is *no* time-based exponential decay term inside the
 * GLSL. All amplitude control lives on the JS side via this module,
 * which means a sustain call can keep the wobble at full strength
 * indefinitely just by re-pinning amp every frame, without fighting a
 * shader-side decay.
 */

export interface JiggleUniforms {
  uJiggleCenter: { value: THREE.Vector3 };
  uJiggleTime: { value: number };
  uJiggleAmp: { value: number };
}

/**
 * Peak amplitude (in object-space units) of a fresh click poke.
 * Multiplied by the spatial falloff in the shader, so this is the
 * theoretical maximum displacement at the click point at amp = peak.
 */
const AMP_PEAK = 0.22;

/**
 * Sustained "hand in water" amplitude held while the cursor is hovering
 * the body. Lower than {@link AMP_PEAK} because it persists — at peak
 * the silhouette would deform too aggressively for a passive UI element.
 * Tuned to read as a clear flowing ripple without making the shape
 * unreadable as a baseball / football / etc.
 */
const HOVER_SUSTAIN_AMP = 0.16;

/**
 * Once a mesh's `uJiggleAmp` decays under this threshold we treat it as
 * resting and clamp it to zero so the GPU stops doing displacement work.
 */
const AMP_REST = 0.0008;

/**
 * Per-second decay rate of the amplitude after a click impulse. Higher
 * than the previous design because the shader no longer applies its own
 * `exp(-time · 1.8)` factor — every bit of amplitude decay now lives in
 * JS so {@link sustainJiggle} can override it cleanly.
 */
const DECAY_RATE = 3.5;

/**
 * Smoothing factor for the sustain ramp-up. With `dt ≈ 16ms` and `k ≈
 * 8`, the amp closes ~80% of its remaining gap to the hover target
 * over the first frame and is essentially at the target inside two
 * frames — fast enough to feel responsive, smooth enough that the
 * wobble doesn't snap on.
 */
const SUSTAIN_RAMP_K = 10;

export function createJiggleUniforms(): JiggleUniforms {
  return {
    uJiggleCenter: { value: new THREE.Vector3() },
    uJiggleTime: { value: 0 },
    uJiggleAmp: { value: 0 },
  };
}

/**
 * Trigger a fresh impulse wobble centered at `localPoint` (object-local
 * space).
 *
 * `amp` is optional and defaults to {@link AMP_PEAK}. Subsequent calls
 * overwrite the previous impulse rather than accumulating, so chaining
 * several pokes during a morph window keeps the wobble at full energy
 * without compounding it past sane bounds.
 */
export function pokeJiggle(
  uniforms: JiggleUniforms,
  localPoint: THREE.Vector3,
  amp: number = AMP_PEAK,
): void {
  uniforms.uJiggleCenter.value.copy(localPoint);
  uniforms.uJiggleTime.value = 0;
  uniforms.uJiggleAmp.value = amp;
}

/**
 * Hold the wobble at the sustain amplitude (default
 * {@link HOVER_SUSTAIN_AMP}) and update the wave center to track the
 * cursor's projection on the morphed surface.
 *
 * Time still advances each call, so the ripples keep animating; the
 * amp is smoothly ramped toward the target so a fresh hover doesn't
 * snap the body. Call every frame the cursor is over the body.
 */
export function sustainJiggle(
  uniforms: JiggleUniforms,
  localPoint: THREE.Vector3,
  delta: number,
  targetAmp: number = HOVER_SUSTAIN_AMP,
): void {
  uniforms.uJiggleCenter.value.copy(localPoint);
  uniforms.uJiggleTime.value += delta;
  const k = Math.min(1, delta * SUSTAIN_RAMP_K);
  const cur = uniforms.uJiggleAmp.value;
  uniforms.uJiggleAmp.value = cur + (targetAmp - cur) * k;
}

/**
 * Advance the wobble by `delta` seconds in *decay* mode — used when no
 * external sustain is keeping the wave alive. Decays amplitude
 * exponentially and zeros it out once it crosses the rest threshold.
 */
export function tickJiggle(uniforms: JiggleUniforms, delta: number): void {
  uniforms.uJiggleTime.value += delta;
  if (uniforms.uJiggleAmp.value <= 0) return;
  uniforms.uJiggleAmp.value *= Math.exp(-DECAY_RATE * delta);
  if (uniforms.uJiggleAmp.value < AMP_REST) {
    uniforms.uJiggleAmp.value = 0;
  }
}
