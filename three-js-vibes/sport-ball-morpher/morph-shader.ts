import * as THREE from "three";

import type { JiggleUniforms } from "./jiggle";
import type { SurfaceDistanceFn } from "./surface-distance";

/**
 * Per-vertex silhouette morph + click-to-jello jiggle, layered into a single
 * `MeshStandardMaterial` shader patch.
 *
 * The morph term is what makes the cycle a *true* morph instead of a
 * crossfade: every vertex of every sport mesh stores the unit direction
 * from origin to its rest position (`aDirection`) plus its rest distance
 * (`aRestDist`). When the show controller is about to advance from sport
 * A to sport B, it precomputes a "target distance" for each vertex of
 * BOTH meshes — the outgoing mesh's targets are sampled from sport B's
 * surface, the incoming mesh's targets are sampled from sport A's. Then
 * both meshes step their `uMorphT` uniforms in lockstep:
 *
 *   - outgoing: `uMorphT 0 → 1` (rest A morphs toward B's silhouette)
 *   - incoming: `uMorphT 1 → 0` (starts at A's silhouette, morphs to rest B)
 *
 * Because both meshes use the same pair of surface distance functions,
 * their silhouettes match at every moment of the morph — `dir · mix(restDist,
 * targetDist, t)` produces the same point cloud envelope on both, so the
 * crossfaded opacity reads as one shape molding into the next rather than
 * two shapes briefly overlapping. There is no longer a "puddle" pose, no
 * disappearance window, and no scale-spring pop.
 *
 * The jiggle term sits on top of the morphed position. Its center is in
 * the *rest* coordinate space of the mesh (so a click hit on the rest
 * basketball still wobbles the right spot once the basketball has morphed
 * into a football).
 */

export interface MorphUniforms {
  /**
   * Morph progress in [0, 1]. The shader applies a cubic smoothstep to it
   * so the shape eases into and out of each end-pose without a linear
   * ramp's visible slope discontinuity.
   */
  uMorphT: { value: number };
}

export function createMorphUniforms(): MorphUniforms {
  return { uMorphT: { value: 0 } };
}

/**
 * Compute and attach the per-vertex `aDirection` (unit vector from origin
 * to rest position) and `aRestDist` (length of rest position) attributes,
 * plus an initially-equal `aTargetDist` slot the controller will overwrite
 * each morph cycle.
 *
 * Vertices that happen to sit exactly at the origin (rare — would mean a
 * degenerate mesh) get an arbitrary (+y) fallback direction so the shader
 * never sees a NaN normalize.
 */
export function attachMorphAttributes(geometry: THREE.BufferGeometry): void {
  const posAttr = geometry.attributes.position;
  const pos = posAttr.array as Float32Array;
  const count = posAttr.count;
  const directions = new Float32Array(count * 3);
  const restDists = new Float32Array(count);
  const targetDists = new Float32Array(count);
  for (let i = 0; i < count; i++) {
    const x = pos[i * 3];
    const y = pos[i * 3 + 1];
    const z = pos[i * 3 + 2];
    const d = Math.sqrt(x * x + y * y + z * z);
    if (d > 1e-9) {
      directions[i * 3] = x / d;
      directions[i * 3 + 1] = y / d;
      directions[i * 3 + 2] = z / d;
    } else {
      directions[i * 3] = 0;
      directions[i * 3 + 1] = 1;
      directions[i * 3 + 2] = 0;
    }
    restDists[i] = d;
    targetDists[i] = d;
  }
  geometry.setAttribute(
    "aDirection",
    new THREE.BufferAttribute(directions, 3),
  );
  geometry.setAttribute("aRestDist", new THREE.BufferAttribute(restDists, 1));
  geometry.setAttribute(
    "aTargetDist",
    new THREE.BufferAttribute(targetDists, 1),
  );
}

/**
 * Recompute every vertex's `aTargetDist` from the supplied surface distance
 * function and flag the buffer for re-upload. Called once per morph cycle
 * (when the controller picks a new outgoing/incoming pair); the per-frame
 * cost during a morph is just stepping the `uMorphT` uniform.
 */
export function setMorphTarget(
  geometry: THREE.BufferGeometry,
  surfaceDistance: SurfaceDistanceFn,
): void {
  const dirAttr = geometry.getAttribute("aDirection");
  const targetAttr = geometry.getAttribute("aTargetDist") as THREE.BufferAttribute;
  if (!dirAttr || !targetAttr) return;
  const dirArray = dirAttr.array as Float32Array;
  const targetArray = targetAttr.array as Float32Array;
  for (let i = 0; i < dirAttr.count; i++) {
    const dx = dirArray[i * 3];
    const dy = dirArray[i * 3 + 1];
    const dz = dirArray[i * 3 + 2];
    targetArray[i] = surfaceDistance(dx, dy, dz);
  }
  targetAttr.needsUpdate = true;
}

/**
 * Patch a `MeshStandardMaterial`'s vertex stage to apply the silhouette
 * morph and the click-to-jello jiggle in one combined `onBeforeCompile`
 * pass.
 *
 * Why combine the two terms in a single hook instead of chaining two? Each
 * hook layer has to find an unmodified token (`#include <begin_vertex>` or
 * its replacement text) before it can splice in its code. Chaining two
 * means the second hook depends on the first hook's exact output string,
 * which is fragile across three.js minor versions. One unified hook is
 * the simplest stable seam.
 *
 * The injected vertex code overrides three.js's default `transformed =
 * vec3(position)` with `transformed = aDirection · mix(aRestDist, aTargetDist,
 * smoothstep(uMorphT))`. This means *all* of the mesh's surface details
 * (sphere, lathe, cylinder, prolate spheroid, decoration tubes…) deform
 * radially toward the next sport's silhouette as one body. Decorations
 * that ride on `InstancedMesh` (e.g. baseball stitches) cannot use vertex
 * attributes and so opt out of the morph — they fade in/out at the morph
 * boundaries instead. See `mesh-builders.ts` for the per-sport wiring.
 */
export function attachSportShader(
  material: THREE.MeshStandardMaterial,
  morph: MorphUniforms,
  jiggle: JiggleUniforms,
): void {
  material.onBeforeCompile = (shader) => {
    shader.uniforms.uMorphT = morph.uMorphT;
    shader.uniforms.uJiggleCenter = jiggle.uJiggleCenter;
    shader.uniforms.uJiggleTime = jiggle.uJiggleTime;
    shader.uniforms.uJiggleAmp = jiggle.uJiggleAmp;

    shader.vertexShader = shader.vertexShader
      .replace(
        "#include <common>",
        `#include <common>
attribute vec3 aDirection;
attribute float aRestDist;
attribute float aTargetDist;
uniform float uMorphT;
uniform vec3 uJiggleCenter;
uniform float uJiggleTime;
uniform float uJiggleAmp;`,
      )
      .replace(
        "#include <begin_vertex>",
        `// Silhouette morph: the rest mesh's per-vertex direction × distance
// is interpolated toward the target sport's distance along the same ray.
// Both meshes in a morph use the same pair of surface distance fns, so
// their silhouettes coincide at every value of t — what the eye sees is
// one continuously molding shape, not two crossfading objects.
float morphT = smoothstep(0.0, 1.0, clamp(uMorphT, 0.0, 1.0));
float morphedDist = mix(aRestDist, aTargetDist, morphT);
vec3 transformed = aDirection * morphedDist;

if (uJiggleAmp > 0.0) {
  float jDecay = exp(-uJiggleTime * 2.0);

  // Whole-body breathing pulse — same 8 rad/s as the rest-pose jello.
  float jPulse = uJiggleAmp * jDecay * cos(uJiggleTime * 8.0) * 0.35;
  transformed *= 1.0 + jPulse;

  // Local ripple, centered at the user's click point in the mesh's REST
  // coordinate space (uJiggleCenter never moves with the morph), so a
  // click on, say, the basketball's seam still wobbles that exact spot
  // even as the basketball's silhouette is morphing toward a football.
  float jDist = length(aDirection * aRestDist - uJiggleCenter);
  float jRadial = exp(-jDist * 0.55);
  float jWave = cos(uJiggleTime * 10.0 - jDist * 2.0);
  float jDisp = uJiggleAmp * jDecay * jRadial * jWave;
  transformed += aDirection * jDisp;
}`,
      );
  };
  material.needsUpdate = true;
}
