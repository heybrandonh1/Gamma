import * as THREE from "three";

/**
 * Click-to-jello deformation.
 *
 * When the user clicks anywhere on a sport mesh, we kick off a damped wave
 * that originates at the click point and ripples outward across the surface,
 * pushing each vertex along its normal. The result feels like poking a piece
 * of jello: the spot you press wobbles the most, the rest of the body
 * trembles in sympathy, and the whole thing settles back to rest in about a
 * second.
 *
 * Implementation: every `MeshStandardMaterial` that participates in the
 * jiggle gets its vertex shader patched via `onBeforeCompile` to inject a
 * displacement term that reads from three shared uniforms — click point,
 * time-since-click, and peak amplitude. The same `JiggleUniforms` object is
 * shared across every material in a single `SportMesh`, so all sub-meshes
 * (sphere + seams, panels + underlay, etc.) deform in lockstep from the
 * exact same wave.
 *
 * Why not whole-group scale instead? A scale impulse moves the entire mesh
 * uniformly — it can't tell the eye *where* the user pressed. Per-vertex
 * shader displacement is what makes "click any specific part" land: the
 * wobble is centered on the click point and falls off radially, which is
 * the kinetic signature of poking a soft body.
 *
 * Caveats:
 *   - Stitches / seams that ride on `InstancedMesh` (baseball stitches) opt
 *     out of the jiggle; they stay rigidly anchored to their original
 *     positions while the underlying sphere wobbles. Amplitude is small
 *     enough (a few % of unit radius) that the visual mismatch reads as
 *     intentional surface squish rather than a bug.
 *   - The `bumpMap` on the basketball / football is in fragment-space and
 *     doesn't update when vertices move, so its grain may "swim" subtly
 *     during the wobble. Acceptable at this amplitude / duration.
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
 *
 * Tuned high enough that a single click reads as a profound jello wobble
 * across the whole body — at this scale the body's silhouette visibly
 * heaves with each oscillation, not just the spot under the cursor.
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
 * the body wobbles for the better part of three seconds before settling —
 * long enough for several visible oscillations of the slow ~10 rad/s wave.
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
 * Patch a `MeshStandardMaterial` so its vertex shader reads from the shared
 * `JiggleUniforms` and adds a damped, spatially-falling-off sine wave to
 * each vertex's position along its normal.
 *
 * Uses `onBeforeCompile` so we don't have to fork `MeshStandardMaterial` —
 * three.js still owns lighting, shadows, IBL, bump-map sampling, etc., and
 * we just slot a single extra term into `<begin_vertex>`.
 */
export function attachJiggleShader(
  material: THREE.MeshStandardMaterial,
  uniforms: JiggleUniforms,
): void {
  const prev = material.onBeforeCompile;
  material.onBeforeCompile = (shader, renderer) => {
    if (prev) prev.call(material, shader, renderer);

    shader.uniforms.uJiggleCenter = uniforms.uJiggleCenter;
    shader.uniforms.uJiggleTime = uniforms.uJiggleTime;
    shader.uniforms.uJiggleAmp = uniforms.uJiggleAmp;

    shader.vertexShader = shader.vertexShader
      .replace(
        "#include <common>",
        `#include <common>
uniform vec3 uJiggleCenter;
uniform float uJiggleTime;
uniform float uJiggleAmp;`,
      )
      .replace(
        "#include <begin_vertex>",
        `#include <begin_vertex>
if (uJiggleAmp > 0.0) {
  float jDecay = exp(-uJiggleTime * ${DECAY_RATE.toFixed(2)});

  // Whole-body breathing pulse: scale every vertex radially around the
  // origin so the click impact registers in the silhouette, not just at
  // the click point. Slightly slower than the local ripple (8 vs 10 rad/s)
  // so the two go out of phase over time, giving the mass that wobbly,
  // out-of-sync, "different parts of the jelly are doing different things"
  // feel that one-frequency motion can't.
  float jPulse = uJiggleAmp * jDecay * cos(uJiggleTime * 8.0) * 0.35;
  transformed *= 1.0 + jPulse;

  // Local ripple: damped wave centered at the click point, falling off
  // gently with distance so a sizeable fraction of the body shares in
  // each oscillation. cos() (not sin) so the click point is at maximum
  // outward displacement at t = 0 — i.e. the impact pushes outward
  // first, then bounces in, mirroring how a poke into real jelly reads.
  float jDist = length(position - uJiggleCenter);
  float jRadial = exp(-jDist * 0.55);
  float jWave = cos(uJiggleTime * 10.0 - jDist * 2.0);
  float jDisp = uJiggleAmp * jDecay * jRadial * jWave;
  transformed += normalize(normal) * jDisp;
}`,
      );
  };
  // Force three.js to recompile this material's program so our patched
  // chunks are picked up the first time it's drawn.
  material.needsUpdate = true;
}

/**
 * Trigger a fresh wobble centered at `localPoint` (object-local space).
 *
 * `amp` is optional and defaults to {@link AMP_PEAK} (the click intensity).
 * The morph cycle in the show controller passes a higher value to make the
 * transition wobble visibly more energetic than a passive click — same
 * shader, just a louder strike. Subsequent calls overwrite the previous
 * impulse rather than accumulating, so chaining several pokes during a
 * morph window keeps the wobble at full energy without compounding it
 * past sane bounds.
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
