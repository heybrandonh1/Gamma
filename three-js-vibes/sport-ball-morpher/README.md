# Sport Ball Morpher

A 3D showcase of six procedural sport-equipment shapes — baseball, bat,
basketball, football, soccer ball, hockey puck — that auto-cycle on a lit
stage as **one continuously morphing mass**. Nothing crossfades, nothing
disappears; the body smoothly molds from each sport into the next with its
silhouette, color, surface decorations, and material response all changing
on a single per-vertex blend, like a lava lamp where each blob remembers
how to be a baseball or a football.

The viewer can grab the canvas and freely orbit the camera 360° to inspect
the active object from any angle, and **click anywhere on the body to poke
it with a wavy multi-frequency jello wobble** — three desynchronised damped
sine terms ride the surface for a couple of seconds, so different parts of
the body bob at slightly different times the way real jelly does.

Lives inside the [Gamma](https://github.com/heybrandonh1/Gamma) submodule
and mounts in Project Alpha's `/playground` page via
`lib/playground-vibes.tsx`.

## How the morph works

The previous architecture kept a separate `THREE.Group` per sport and
crossfaded their opacity while morphing each one's silhouette toward the
other. Even with mathematically matched silhouettes, two overlapping
meshes with different vertex distributions and different triangle
topologies always reveal themselves at the boundary — the eye reads the
transition as "outgoing fading out, incoming fading in", not as one shape
molding into the next. So we threw it out.

This rewrite uses **one mesh, every sport**:

1. A shared high-resolution `SphereGeometry(1, 192, 96)` (~18 600
   vertices) is the base. Its triangle topology never changes — only the
   per-vertex positions and colors do.

2. At mount time, for every sport in the catalogue, we precompute two
   `Float32Array`s of length `numVerts × 3`:
     - **Per-vertex position**: along each vertex's outward unit
       direction, we evaluate that sport's `surfaceDist(d)` ray-hit
       function (sphere, lathe, prolate spheroid, capped cylinder) to
       find where the sport's surface lives, then place the vertex
       there. So each sport gets its own per-vertex projection of the
       same sphere.
     - **Per-vertex color**: each sport's `colorAt(d)` paints the body's
       albedo at that direction *including* its decoration — baseball
       stitches along the figure-8 seam curve, basketball seams along
       four great circles, football lace strip + cross stitches, soccer
       pentagon/hexagon panel pattern, hockey puck rim band. The
       decoration is encoded in the per-vertex color, not as a separate
       mesh, so it morphs along with the silhouette automatically.

3. Two attribute slots A and B hold the *current* and *next* sport's
   data. The vertex shader interpolates:

       float t = smoothstep(0, 1, uBlend);
       transformed   = mix(aPosA, aPosB, t);
       vMorphedColor = mix(aColA, aColB, t);
       objectNormal  = normalize(transformed);

   `uBlend = 0` means "fully sport A"; `uBlend = 1` means "fully sport
   B". The shader recomputes the surface normal from the morphed
   position so lighting follows the silhouette and doesn't strobe
   between the two sports' rest normals at intermediate blends.

4. PBR scalars (`roughness`, `metalness`, `envMapIntensity`) ride the
   same blend on the JS side — `material.roughness =
   mix(sportA.roughness, sportB.roughness, smoothstep(uBlend))` each
   frame — so the leather-baseball-to-polished-puck visual transition
   isn't snapped at the cycle boundary either.

5. The show controller does the smallest possible animation loop:
     - Hold at slot A's rest pose for ~2.4 s (`uBlend = 0`).
     - Tween `uBlend: 0 → 1` over ~1.8 s with `power2.inOut`.
     - On completion, ask the body to promote slot B's contents into
       slot A and load sport `(current + 2) mod n` into slot B; reset
       `uBlend = 0`.
     - Loop.

There is exactly **one mesh in the scene** at all times. There is no
opacity crossfade, no overlapping silhouette pair, no separate decoration
layer fading in or out. The morph is the entire transition.

## Wavy jello

Click the body and the vertex shader layers a damped multi-frequency
wave on top of the morphed position:

    if (uJiggleAmp > 0.0) {
      float decay  = exp(-uJiggleTime * 1.8);
      float dist   = length(transformed - uJiggleCenter);
      float radial = exp(-dist * 0.5);

      float wave = 0.55 * cos(uJiggleTime * 8.0  - dist * 3.0)
                 + 0.30 * cos(uJiggleTime * 12.0 - dist * 5.5)
                 + 0.18 * cos(uJiggleTime * 18.0 - dist * 9.5);

      float disp = uJiggleAmp * decay * radial * wave;
      transformed += aDirection * disp;

      // whole-body breathing pulse
      transformed *= 1.0 + uJiggleAmp * decay * cos(uJiggleTime * 6.0) * 0.18;
    }

The three sine terms tick at 8, 12, and 18 rad/s with progressively
shorter spatial wavelengths, so they go in and out of phase across the
~2.8 s decay window — the silhouette ripples in waves that don't repeat
themselves, the way real jelly behaves when you poke it.

The poke center is computed in the host component by raycasting against
the rest sphere (the body mesh's `position` attribute is still the unit
sphere — the morph happens in the shader), normalizing the hit to a unit
direction, then projecting that direction onto the *current morphed
surface* using a CPU mirror of the same `mix(distA, distB,
smoothstep(uBlend))` formula. The wave radiates outward from where the
user actually clicked even mid-morph.

## Anatomy

- [`sport-specs.ts`](./sport-specs.ts) — six `SportSpec`s (key, name,
  `surfaceDist`, `colorAt`, rim-light tint, spin axis + speed,
  PBR scalars). The procedural decoration math (baseball stitch curve,
  basketball seam normals, soccer ball pentagon centers from icosahedron
  vertices, football lace strip + cross-stitches, hockey rim band) all
  lives inside the `colorAt` callbacks.
- [`surface-distance.ts`](./surface-distance.ts) — analytical /
  numerical ray-from-origin distance helpers used by the specs:
    - `makeSphereDist(r)` — trivial.
    - `makeFootballDist(R, zStretch, tipFalloff)` — iterative solve of
      a prolate spheroid with quartic tip taper.
    - `makeLatheDist(profile)` — closed-form solve through a lathe
      profile, segment by segment (drives the bat).
    - `makeCylinderDist(r, halfH, axis)` — capped cylinder ray hit
      (drives the hockey puck along +X).
- [`unified-body.ts`](./unified-body.ts) — builds the single shared
  mesh, bakes every sport's position + color buffer, wires the
  `MeshStandardMaterial` `onBeforeCompile` patch that does the morph +
  wavy jello in a single hook, and exposes `setBlend`,
  `cycleAndLoad(next)`, `poke`, `tick`. Also exports
  `morphedSurfacePoint` for the host component's click projection.
- [`jiggle.ts`](./jiggle.ts) — uniform owner + `pokeJiggle` /
  `tickJiggle` helpers for the wavy-jello state. The actual GLSL is in
  `unified-body.ts` so it can layer onto the morphed position.
- [`show-controller.ts`](./show-controller.ts) — the hold-tween-cycle
  loop, plus rim-light tint blending and a small "splat" poke when
  each new sport lands.
- [`sport-ball-morpher.tsx`](./sport-ball-morpher.tsx) — React component.
  Sets up the renderer, scene, camera, lighting, PMREM environment from
  `RoomEnvironment`, the unified body, the controller,
  `OrbitControls` for free 360° camera, and the click-to-jello raycast.

## Realism: PMREM environment

The materials get image-based lighting from a PMREM-generated cubemap
of the procedural `RoomEnvironment` shipped in three.js examples — no
HDR asset required. Without it the surfaces read flat; with it every
sport gets believable reflections and shading falloff that morph along
with the geometry.

## Interaction

- **Drag** anywhere on the canvas to rotate the camera 360° in any
  direction.
- **Click** any specific part of the body to poke it — a damped
  multi-frequency wave radiates from the click point, wobbles outward,
  and settles back to rest in about three seconds. Drags are
  disambiguated from clicks by pointer travel distance (≤ 6 px) and
  press duration (≤ 350 ms), so orbiting and poking don't fight each
  other.
- **Pinch / scroll** is disabled (this is an inspection view, not a
  flythrough).
- The body auto-spins on the active sport's natural axis (bat along Y,
  football along Z, puck along X) at the active sport's speed; the
  orbit camera is independent.
- The cycle auto-advances every ~2.4 s + ~1.8 s morph.
  `prefers-reduced-motion` pauses it.

## Accessibility

- `prefers-reduced-motion` pauses the cycle and the auto-spin.
- The mounted `<div>` carries `role="img"` with an `aria-label`
  describing the gallery and the drag/click interaction.
- The `<VibeFallback>` square is rendered when WebGL is missing or the
  renderer fails to initialize.
