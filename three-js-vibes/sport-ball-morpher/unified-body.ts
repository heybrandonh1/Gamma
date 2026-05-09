import * as THREE from "three";

import {
  createJiggleUniforms,
  pokeJiggle,
  sustainJiggle,
  tickJiggle,
  type JiggleUniforms,
} from "./jiggle";
import type { SportSpec } from "./sport-specs";

/**
 * One mesh, every sport.
 *
 * The previous architecture kept a separate `THREE.Group` per sport and
 * tried to crossfade them via opacity while morphing each one's
 * silhouette toward the other. Even with matched silhouettes, two
 * overlapping meshes with different vertex distributions and triangle
 * topologies always reveal themselves at the boundary — the eye reads
 * the transition as "outgoing fading out, incoming fading in", not as
 * one mass molding into the next.
 *
 * This module replaces all of that with **one** continuously-morphing
 * mesh. A shared high-resolution sphere is the base; for every sport
 * we precompute, for every vertex, where that sport's surface lives
 * along the vertex's outward direction (`aPosA[i]`) and what color the
 * sport paints at that direction (`aColA[i]`, including procedural
 * decoration like baseball stitches, basketball seams, soccer panels,
 * football laces, hockey rim band). Two slots A and B hold the
 * "current" and "next" sport's data; a single `uBlend` uniform
 * smoothstep-interpolates every per-vertex channel from A to B.
 *
 * When the cycle advances, the controller calls `cycleAndLoad(nextIndex)`:
 * the contents of slot B are copied into slot A (so what was "next" is
 * now "current") and slot B is repopulated from the new next sport.
 * `uBlend` resets to 0. The hold + tween + cycle loop runs forever.
 *
 * Result: the visible body is always exactly *one* mesh, evolving its
 * vertex positions and colors continuously. There is no opacity
 * crossfade, no pair of overlapping silhouettes, no decoration
 * fade-in/out. The morph itself is the entire transition. The body's
 * triangle topology never changes — only the per-vertex positions and
 * colors do — so the morph reads as a soft mass smoothly molding from
 * sport A into sport B, the way a metaball would.
 *
 * Click-to-jello layers a multi-frequency damped wave on top of the
 * morphed positions in the vertex shader. Three sine terms at slightly
 * desynchronised periods (8 / 12 / 18 rad/s) with progressively shorter
 * spatial wavelengths give a "wavy" wobble — different parts of the
 * body bob at slightly different times and amplitudes the way real
 * jello does, instead of one uniform sine ringing.
 */

/**
 * Resolution of the shared sphere. 256 width × 128 height ≈ 33 153
 * vertices, ~1.4° of angular spacing at the equator. That's the
 * resolution at which the finer per-sport details (golf-ball dimples,
 * cricket-ball stitches, volleyball panel seams, soccer pentagon
 * boundaries, football tip taper) render as crisp painted patterns
 * instead of fuzzy noise. The whole vibe still runs on a single
 * draw call.
 *
 * Mount-time bake cost grows linearly: ~150 ms across all sports on
 * a current laptop, paid once.
 */
const SPHERE_W = 256;
const SPHERE_H = 128;

export interface UnifiedSportBody {
  object: THREE.Mesh;
  /**
   * Set the active blend in [0, 1]. 0 = pure slot A, 1 = pure slot B.
   * The shader applies a cubic smoothstep so the morph eases in / out
   * without a linear-ramp slope discontinuity at the endpoints.
   */
  setBlend(t: number): void;
  /**
   * Promote slot B's contents into slot A and load `nextSportIndex`'s
   * data into slot B. Resets `uBlend` to 0. Call this *exactly once*
   * after each morph completes — the show controller does so in its
   * tween's `onComplete` hook.
   */
  cycleAndLoad(nextSportIndex: number): void;
  /**
   * Project a click on the rest sphere onto the actual morphed surface
   * and trigger an impulse wavy-jello wobble centered there.
   * `localPoint` is in the mesh's local space (typically derived from
   * a raycast hit `point` passed through `worldToLocal`).
   */
  poke(localPoint: THREE.Vector3, amp?: number): void;
  /**
   * Hold a sustained "hand in water" wobble centered at `localPoint`.
   * Call every frame the cursor is over the body. The amplitude
   * smoothly ramps up from rest and stays pinned at the sustain
   * level, so the surface keeps rippling at full strength as long as
   * the host keeps calling this. Updates the wave center on every
   * call so the wave follows the cursor.
   */
  setHover(localPoint: THREE.Vector3): void;
  /**
   * Drop the sustain hold — the wave amplitude resumes its normal
   * exponential decay and the wave dies out naturally. Cheap to call
   * (idempotent), so the host can call it every frame the cursor is
   * not over the body without worrying about state tracking.
   */
  clearHover(): void;
  /**
   * Step the wobble's time uniform forward. While hover is active,
   * pin the amplitude at the sustain level; otherwise decay it.
   */
  tick(dt: number): void;
  /** Update the rim-light tint to match the *currently displayed* blend. */
  blendedRimColor(out: THREE.Color): THREE.Color;
  /** Auto-rotation axis interpolated between slot A and slot B's spin axes. */
  currentSpinAxis(): "x" | "y" | "z";
  currentSpinSpeed(): number;
  dispose(): void;
}

/**
 * Build the shared sphere, bake every sport's per-vertex data, and wire
 * up a single `MeshStandardMaterial` whose vertex / fragment stages we
 * patch via `onBeforeCompile` to interpolate per-vertex positions and
 * colors plus apply the wavy-jello wobble.
 *
 * Holding all sports' positions and colors in attribute storage keeps
 * the per-frame cost trivial (one uniform write to `uBlend`) and the
 * per-cycle cost bounded (one `Float32Array.set` per channel when slots
 * promote). No per-frame CPU↔GPU sync, no per-vertex JS work during
 * the morph itself.
 */
export function buildUnifiedSportBody(
  sports: SportSpec[],
): UnifiedSportBody {
  if (sports.length < 2) {
    throw new Error("unified body needs at least two sports");
  }

  const geometry = new THREE.SphereGeometry(1, SPHERE_W, SPHERE_H);
  const numVerts = geometry.attributes.position.count;

  // Precompute per-vertex unit direction once. Used as the radial axis
  // for both the silhouette projection and the wave displacement, so it
  // gets its own attribute slot so the shader doesn't have to
  // `normalize(position)` per vertex per frame.
  const directions = new Float32Array(numVerts * 3);
  {
    const pos = geometry.attributes.position.array as Float32Array;
    for (let i = 0; i < numVerts; i++) {
      const x = pos[i * 3];
      const y = pos[i * 3 + 1];
      const z = pos[i * 3 + 2];
      const len = Math.sqrt(x * x + y * y + z * z);
      directions[i * 3] = x / len;
      directions[i * 3 + 1] = y / len;
      directions[i * 3 + 2] = z / len;
    }
  }
  geometry.setAttribute(
    "aDirection",
    new THREE.BufferAttribute(directions, 3),
  );

  // Per-sport baked data. We keep the whole catalogue in memory because
  // a six-sport rotation through ~18k vertices is only ~1.3 MB total
  // for positions + ~1.3 MB for colors — trivial — and slot promotion
  // becomes a `Float32Array.set` from one canonical source instead of a
  // recompute every cycle.
  const tmpColor = new THREE.Color();
  const sportData: Array<{ positions: Float32Array; colors: Float32Array }> =
    sports.map((sport) => {
      const positions = new Float32Array(numVerts * 3);
      const colors = new Float32Array(numVerts * 3);
      for (let i = 0; i < numVerts; i++) {
        const dx = directions[i * 3];
        const dy = directions[i * 3 + 1];
        const dz = directions[i * 3 + 2];
        const dist = sport.surfaceDist(dx, dy, dz);
        positions[i * 3] = dx * dist;
        positions[i * 3 + 1] = dy * dist;
        positions[i * 3 + 2] = dz * dist;
        sport.colorAt(dx, dy, dz, tmpColor);
        colors[i * 3] = tmpColor.r;
        colors[i * 3 + 1] = tmpColor.g;
        colors[i * 3 + 2] = tmpColor.b;
      }
      return { positions, colors };
    });

  // Slot A starts as sport 0; slot B as sport 1.
  const aPos = new THREE.BufferAttribute(sportData[0].positions.slice(), 3);
  const bPos = new THREE.BufferAttribute(sportData[1].positions.slice(), 3);
  const aCol = new THREE.BufferAttribute(sportData[0].colors.slice(), 3);
  const bCol = new THREE.BufferAttribute(sportData[1].colors.slice(), 3);
  geometry.setAttribute("aPosA", aPos);
  geometry.setAttribute("aPosB", bPos);
  geometry.setAttribute("aColA", aCol);
  geometry.setAttribute("aColB", bCol);

  let slotA = 0;
  let slotB = 1;

  // Per-frame uniforms: the morph blend itself + the click-to-jello
  // state. Material tunings (`roughness`, `metalness`, `envMapIntensity`)
  // are *not* shader-side uniforms here — they're plain JS-side
  // properties on the `MeshStandardMaterial` that we re-blend each
  // frame from `sports[slotA]` and `sports[slotB]`. three.js's
  // material auto-uploads them to the corresponding standard uniforms
  // every render, so this is the simplest stable seam without
  // monkey-patching internal shader chunks (the names of which can
  // change between three.js minor versions).
  const jiggle: JiggleUniforms = createJiggleUniforms();
  const uniforms = {
    uBlend: { value: 0 },
  };

  const material = new THREE.MeshStandardMaterial({
    color: 0xffffff,
    vertexColors: false,
    roughness: sports[0].roughness,
    metalness: sports[0].metalness,
    envMapIntensity: sports[0].envMapIntensity,
  });

  /**
   * Single `onBeforeCompile` patch that splices the morph (per-vertex
   * position + color blend), the per-vertex normal recomputation, and
   * the wavy-jello displacement into the standard physical material.
   * We keep all the splices in one hook because chaining hooks makes
   * each layer dependent on the previous one's exact replacement-
   * string output, which is brittle across three.js minor versions.
   */
  material.onBeforeCompile = (shader) => {
    shader.uniforms.uBlend = uniforms.uBlend;
    shader.uniforms.uJiggleCenter = jiggle.uJiggleCenter;
    shader.uniforms.uJiggleTime = jiggle.uJiggleTime;
    shader.uniforms.uJiggleAmp = jiggle.uJiggleAmp;

    shader.vertexShader = shader.vertexShader
      .replace(
        "#include <common>",
        `#include <common>
attribute vec3 aDirection;
attribute vec3 aPosA;
attribute vec3 aPosB;
attribute vec3 aColA;
attribute vec3 aColB;
uniform float uBlend;
uniform vec3 uJiggleCenter;
uniform float uJiggleTime;
uniform float uJiggleAmp;
varying vec3 vMorphedColor;
varying vec3 vMorphedNormal;`,
      )
      // Recompute the surface normal from the *morphed* position. We use
      // the normalized morphed position direction as the normal, which is
      // exact for star-shaped surfaces (everything we morph through) and
      // very close for the rest. This is the difference between "the
      // morph has correct shading at every blend" and "the lighting
      // strobes between sport-A's normals and sport-B's normals".
      .replace(
        "#include <beginnormal_vertex>",
        `float morphTn = smoothstep(0.0, 1.0, clamp(uBlend, 0.0, 1.0));
vec3 morphedPosForNormal = mix(aPosA, aPosB, morphTn);
vec3 objectNormal = normalize(morphedPosForNormal);
vMorphedNormal = objectNormal;
#ifdef USE_TANGENT
vec3 objectTangent = vec3(tangent.xyz);
#endif`,
      )
      .replace(
        "#include <begin_vertex>",
        `// Smooth-eased blend between slot A and slot B.
float morphT = smoothstep(0.0, 1.0, clamp(uBlend, 0.0, 1.0));
vec3 transformed = mix(aPosA, aPosB, morphT);

// Wavy-jello wobble layered on the morphed position.
//
// Three desynchronised sine terms ride at decreasing amplitude and
// decreasing spatial wavelength. The terms tick at 8, 12, 18 rad/s
// respectively, so they go in and out of phase over the ~2 s impulse
// window (or indefinitely under hover sustain) — the silhouette
// ripples in waves that don't repeat themselves, the way real jelly
// behaves when you poke it / drag your hand through water.
//
// Note there is no time-based decay term in the GLSL: \`uJiggleAmp\`
// is the only amplitude knob, and JS owns its decay (impulse mode)
// or its hold (hover sustain). That keeps the shader oblivious to
// which trigger fired the wobble — both modes share one display path.
//
// The radial spatial falloff (\`exp(-dist · 0.5)\`) keeps the wave
// concentrated around the wave center; the breathing pulse on the
// last line is a whole-body radial scale that registers in the
// silhouette so the impact reads from any camera angle.
if (uJiggleAmp > 0.0) {
  float dist = length(transformed - uJiggleCenter);
  float radial = exp(-dist * 0.5);

  float wave = 0.55 * cos(uJiggleTime * 8.0  - dist * 3.0)
             + 0.30 * cos(uJiggleTime * 12.0 - dist * 5.5)
             + 0.18 * cos(uJiggleTime * 18.0 - dist * 9.5);

  float disp = uJiggleAmp * radial * wave;
  transformed += aDirection * disp;

  // Whole-body breathing pulse, slower than every ripple term so it
  // shows up as a global silhouette heave that reads from any
  // camera angle.
  float pulse = uJiggleAmp * cos(uJiggleTime * 6.0) * 0.14;
  transformed *= 1.0 + pulse;
}

vMorphedColor = mix(aColA, aColB, morphT);`,
      );

    shader.fragmentShader = shader.fragmentShader
      .replace(
        "#include <common>",
        `#include <common>
varying vec3 vMorphedColor;
varying vec3 vMorphedNormal;`,
      )
      // Override the diffuse albedo with the morphed per-vertex color.
      // We don't go through the standard `vColor` path because that
      // would require us to enable `vertexColors` on the material,
      // which has knock-on effects on other shader chunks; injecting
      // the color here keeps the intent local. `diffuseColor` was
      // initialised earlier in `main` from the material's `diffuse`
      // uniform (which we leave at white), so the morphed per-vertex
      // color *is* the surface albedo.
      .replace(
        "#include <color_fragment>",
        `diffuseColor.rgb *= vMorphedColor;`,
      );
  };

  const mesh = new THREE.Mesh(geometry, material);
  // The morph re-projects vertices in the shader, which can briefly
  // grow the silhouette past the rest unit sphere's bounding sphere
  // (e.g. while morphing toward a bat tip at y = 1.42). Disable
  // frustum culling so the morphed shape stays on screen even at
  // extreme blends.
  mesh.frustumCulled = false;

  // Hover sustain state. Lives in the body (rather than externally) so
  // `tick` can cleanly route between sustain mode (pin amp at hover
  // target, advance time) and decay mode (let amp exponential-decay,
  // advance time). The host updates these every animation frame from
  // the cursor's projection on the morphed surface.
  let hoverActive = false;
  const hoverPoint = new THREE.Vector3();

  /** Re-blend the material's PBR scalars from slot A and slot B's values. */
  function refreshMaterialTunings(): void {
    const t = smoothstep01(uniforms.uBlend.value);
    material.roughness =
      sports[slotA].roughness * (1 - t) + sports[slotB].roughness * t;
    material.metalness =
      sports[slotA].metalness * (1 - t) + sports[slotB].metalness * t;
    material.envMapIntensity =
      sports[slotA].envMapIntensity * (1 - t) +
      sports[slotB].envMapIntensity * t;
  }

  return {
    object: mesh,
    setBlend(t) {
      uniforms.uBlend.value = t;
      refreshMaterialTunings();
    },
    cycleAndLoad(nextIndex) {
      const aPosArr = aPos.array as Float32Array;
      const bPosArr = bPos.array as Float32Array;
      const aColArr = aCol.array as Float32Array;
      const bColArr = bCol.array as Float32Array;
      // Promote B → A by copying the buffer (NOT swapping the
      // attribute references — the GPU buffer behind `aPos` is bound
      // to attribute `aPosA` on the shader; switching the JS-side
      // array would not change which GPU buffer the attribute reads).
      aPosArr.set(bPosArr);
      aColArr.set(bColArr);
      // Load the new "next" sport into slot B.
      bPosArr.set(sportData[nextIndex].positions);
      bColArr.set(sportData[nextIndex].colors);
      aPos.needsUpdate = true;
      bPos.needsUpdate = true;
      aCol.needsUpdate = true;
      bCol.needsUpdate = true;
      slotA = slotB;
      slotB = nextIndex;
      uniforms.uBlend.value = 0;
      refreshMaterialTunings();
    },
    poke(localPoint, amp = 0.22) {
      // A click impulse takes priority over any active hover sustain
      // — the two share the same uniforms, so a fresh poke would
      // immediately get overwritten on the next sustain frame
      // anyway. We keep `hoverActive` as-is so the hover state
      // resumes once the impulse is gone (in practice the user
      // usually clicks while hovering, then keeps hovering).
      pokeJiggle(jiggle, localPoint, amp);
    },
    setHover(localPoint) {
      hoverActive = true;
      hoverPoint.copy(localPoint);
    },
    clearHover() {
      hoverActive = false;
    },
    tick(dt) {
      if (hoverActive) {
        sustainJiggle(jiggle, hoverPoint, dt);
      } else {
        tickJiggle(jiggle, dt);
      }
    },
    blendedRimColor(out) {
      const a = new THREE.Color(sports[slotA].rimColor);
      const b = new THREE.Color(sports[slotB].rimColor);
      const t = smoothstep01(uniforms.uBlend.value);
      out.copy(a).lerp(b, t);
      return out;
    },
    currentSpinAxis() {
      // Spin axis snaps at the cycle boundary (the rest pose is what
      // gives each sport its natural axis — bat along Y, football along
      // Z, puck along X — and tweening it through a cardinal flip
      // would just look like wobble). It's keyed off the current
      // *slot* the controller is most-of-the-way-into.
      return uniforms.uBlend.value < 0.5 ? sports[slotA].spinAxis : sports[slotB].spinAxis;
    },
    currentSpinSpeed() {
      const t = smoothstep01(uniforms.uBlend.value);
      return (1 - t) * sports[slotA].spinSpeed + t * sports[slotB].spinSpeed;
    },
    dispose() {
      geometry.dispose();
      material.dispose();
    },
  };
}

function smoothstep01(x: number): number {
  const t = Math.min(1, Math.max(0, x));
  return t * t * (3 - 2 * t);
}

/**
 * CPU-side mirror of the vertex shader's silhouette computation. Lets
 * the host component raycast against the rest sphere and convert the
 * hit to a point on the *morphed* surface, so a click-to-jello wobble
 * starts exactly where the user clicked even mid-morph.
 */
export function morphedSurfacePoint(
  direction: THREE.Vector3,
  blend: number,
  sportA: SportSpec,
  sportB: SportSpec,
  out: THREE.Vector3,
): THREE.Vector3 {
  const dx = direction.x;
  const dy = direction.y;
  const dz = direction.z;
  const a = sportA.surfaceDist(dx, dy, dz);
  const b = sportB.surfaceDist(dx, dy, dz);
  const t = smoothstep01(blend);
  const dist = a * (1 - t) + b * t;
  out.set(dx * dist, dy * dist, dz * dist);
  return out;
}
