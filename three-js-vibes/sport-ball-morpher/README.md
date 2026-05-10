# Sport Ball Morpher

A 3D showcase of eight procedural sport balls — baseball, basketball,
football, soccer ball, cricket ball, tennis ball, golf ball, volleyball
— that auto-cycle on a lit stage as **one continuously morphing mass**.
Nothing crossfades, nothing disappears; the body smoothly molds from each
sport into the next with its silhouette, color, surface decorations, and
material response all changing on a single per-vertex blend, like a lava
lamp where each blob remembers how to be a baseball or a tennis ball.

The viewer can grab the canvas and freely orbit the camera 360° to inspect
the active object from any angle. Two ways to play with the surface:

- **Hover** the cursor over the body and the surface ripples like you're
  moving your hand through water — a continuous multi-frequency wave
  follows the cursor and stays at full strength for as long as the
  pointer is on the body. Move the cursor off and the ripples decay
  away naturally.
- **Click** any specific spot on the body to splash it with a stronger
  impulse wave that decays out over ~1.5 seconds.

Lives inside the [Gamma](https://github.com/heybrandonh1/Gamma) submodule
and mounts in Alpha's `/playground` page via
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

## Wavy jello — two trigger modes, one wave

The vertex shader layers a multi-frequency wave on top of the morphed
position:

    if (uJiggleAmp > 0.0) {
      float dist   = length(transformed - uJiggleCenter);
      float radial = exp(-dist * 0.5);

      float wave = 0.55 * cos(uJiggleTime * 8.0  - dist * 3.0)
                 + 0.30 * cos(uJiggleTime * 12.0 - dist * 5.5)
                 + 0.18 * cos(uJiggleTime * 18.0 - dist * 9.5);

      float disp = uJiggleAmp * radial * wave;
      transformed += aDirection * disp;

      // whole-body breathing pulse
      transformed *= 1.0 + uJiggleAmp * cos(uJiggleTime * 6.0) * 0.14;
    }

The three sine terms tick at 8, 12, and 18 rad/s with progressively
shorter spatial wavelengths, so they go in and out of phase across
their lifetime — the silhouette ripples in waves that don't repeat
themselves, the way real jelly behaves.

Crucially there is **no time-based decay term in the GLSL**.
`uJiggleAmp` is the only amplitude knob. JS owns its lifecycle, which
gives us two clean trigger modes that share the same shader path:

- **Click impulse** — `pokeJiggle` sets amp to its peak and
  `tickJiggle` exponential-decays it over ~1.5 s. Time keeps
  advancing the whole time so the ripple animates as it dies down.
- **Hover sustain** — `sustainJiggle` smoothly ramps amp toward the
  hover hold value and pins it there as long as the host keeps
  calling it (every animation frame the cursor is over the body),
  *while still updating the wave center to follow the cursor*.
  When the host stops calling sustain, `tickJiggle` takes back over
  and the wave decays out as if it were an impulse mid-flight.

The cursor → surface mapping happens on the JS side: the host
component intersects the camera's pick ray with the body's rest unit
sphere in body-local coordinates (so the auto-spinning body doesn't
throw it off), then projects the unit hit direction onto the *current
morphed* surface using a CPU mirror of the same `mix(distA, distB,
smoothstep(uBlend))` blend the vertex shader runs. The wave's center
is therefore exactly on the visible silhouette — even mid-morph, even
while the body is rotating, even while the camera is being dragged.

We re-project on every animation frame, not just on `pointermove`, so
the wave stays under the cursor instead of sliding across the surface
as the body spins beneath it.

## Anatomy

- [`sport-specs.ts`](./sport-specs.ts) — eight `SportSpec`s (key, name,
  `surfaceDist`, `colorAt`, rim-light tint, spin axis + speed, PBR
  scalars). All the procedural decoration math lives inside the
  `colorAt` callbacks:
    - **Baseball**: figure-8 (`φ = A · cos 2θ`) seam curve sampled at
      240 points; stitches modulated by an alternating-slash phase
      pattern along the seam.
    - **Basketball**: four great-circle seam normals, painted as
      angular-distance falloff to the nearest seam plane.
    - **Football**: prolate-spheroid surface evaluation + lace strip
      with 7 cross stitches on the +y meridian.
    - **Soccer ball**: 12 icosahedron-vertex pentagon centers; black
      inside each pentagon's angular disk, white between.
    - **Cricket ball**: equatorial seam plane + 84 discrete white
      stitches paced by `phi = atan2(dz, dx)` periodicity.
    - **Tennis ball**: same `φ = A · cos 2θ` figure-8 family as the
      baseball but rendered as a thicker continuous painted seam
      instead of stitch beats.
    - **Golf ball**: 320 dimple centers placed on the sphere via
      golden-angle Fibonacci spiral; each dimple paints a darker
      "bowl" with a slightly brighter rim band.
    - **Volleyball**: six longitudinal "lune" panels in white / blue /
      yellow, with a stitched darker seam at every panel boundary.
- [`surface-distance.ts`](./surface-distance.ts) — analytical /
  numerical ray-from-origin distance helpers used by the specs:
    - `makeSphereDist(r)` — trivial; drives baseball, basketball,
      soccer, cricket, tennis, golf, volleyball.
    - `makeFootballDist(R, zStretch, tipFalloff)` — iterative solve of
      a prolate spheroid with quartic tip taper.
    - `makeLatheDist(profile)` and `makeCylinderDist(r, halfH, axis)`
      stay exported for future shapes (capped cylinders, lathe-swept
      bats / pins) but no current sport uses them.
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
- **Hover** the body and a sustained "hand in water" multi-frequency
  ripple follows the cursor at full strength. The wave smoothly ramps
  on when the cursor first lands on the body and gracefully decays
  out when the cursor leaves.
- **Click** any specific spot on the body to splash it with a stronger
  impulse — the wave radiates from the click point and decays out over
  ~1.5 s. Drags are disambiguated from clicks by pointer travel
  distance (≤ 6 px) and press duration (≤ 350 ms), so orbiting and
  poking don't fight each other.
- **Pinch / scroll** is disabled (this is an inspection view, not a
  flythrough).
- The body auto-spins on the active sport's natural axis (football
  along Z, the rest along Y) at the active sport's speed; the orbit
  camera is independent.
- The cycle auto-advances every ~2.4 s + ~1.8 s morph.
  `prefers-reduced-motion` pauses it.

## Accessibility

- `prefers-reduced-motion` pauses the cycle and the auto-spin.
- The mounted `<div>` carries `role="img"` with an `aria-label`
  describing the gallery and the drag/click interaction.
- The `<VibeFallback>` square is rendered when WebGL is missing or the
  renderer fails to initialize.
