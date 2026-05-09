import * as THREE from "three";

/**
 * Click-to-jello deformation uniforms + helpers.
 *
 * The actual GLSL for the wobble lives in [morph-shader.ts](./morph-shader.ts)
 * alongside the silhouette morph term — both layer onto the same
 * `MeshStandardMaterial` vertex stage and are spliced in by a single
 * `onBeforeCompile` hook so the injection seam stays stable across
 * three.js minor versions.
 *
 * This module owns:
 *   - the {@link JiggleUniforms} value (click point, time-since-click,
 *     amplitude) shared across every material in a single `SportMesh`,
 *   - {@link pokeJiggle} which kicks off a fresh wobble,
 *   - {@link tickJiggle} which decays the amplitude every frame and
 *     returns the GPU back to idle once the wave has settled.
 *
 * Caveats (unchanged from the previous design):
 *   - Stitches / seams that ride on `InstancedMesh` (baseball stitches) opt
 *     out of the wobble; they stay rigidly anchored to their original
 *     positions while the underlying sphere wobbles. Amplitude is small
 *     enough (a few % of unit radius) that the visual mismatch reads as
 *     intentional surface squish rather than a bug.
 *   - The `bumpMap` on the basketball is in fragment-space and doesn't
 *     update when vertices move, so its grain may "swim" subtly during
 *     the wobble. Acceptable at this amplitude / duration.
 */

export interface JiggleUniforms {
  uJiggleCenter: { value: THREE.Vector3 };
  uJiggleTime: { value: number };
  uJiggleAmp: { value: number };
}

/**
 * Peak amplitude (in object-space units) of a fresh poke. Multiplied by the
 * spatial falloff and the temporal decay in the shader, so this is the
 * theoretical maximum displacement at the click point at t = 0.
 */
const AMP_PEAK = 0.22;

/**
 * Once a mesh's `uJiggleAmp` decays under this threshold we treat it as
 * resting and clamp it to zero so the GPU stops doing displacement work.
 */
const AMP_REST = 0.0008;

/**
 * Per-second decay rate of the amplitude after a poke. With the AMP_PEAK
 * above, `AMP_PEAK · e^(-DECAY · t)` crosses AMP_REST around t ≈ 2.8 s, so
 * the body wobbles for the better part of three seconds before settling.
 */
const DECAY_RATE = 2.0;

export function createJiggleUniforms(): JiggleUniforms {
  return {
    uJiggleCenter: { value: new THREE.Vector3() },
    uJiggleTime: { value: 0 },
    uJiggleAmp: { value: 0 },
  };
}

/**
 * Trigger a fresh wobble centered at `localPoint` (object-local space).
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
 * Advance the wobble by `delta` seconds. Decays amplitude at the same rate
 * the shader's `e^(-DECAY · t)` term does, so we can early-out the GPU work
 * once the wobble is below the rest threshold.
 */
export function tickJiggle(uniforms: JiggleUniforms, delta: number): void {
  if (uniforms.uJiggleAmp.value <= 0) return;
  uniforms.uJiggleTime.value += delta;
  uniforms.uJiggleAmp.value *= Math.exp(-DECAY_RATE * delta);
  if (uniforms.uJiggleAmp.value < AMP_REST) {
    uniforms.uJiggleAmp.value = 0;
  }
}
