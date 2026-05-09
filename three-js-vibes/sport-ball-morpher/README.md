# Sport Ball Morpher

A 3D showcase of six procedural sport-equipment meshes — baseball, bat,
basketball, football, soccer ball, hockey puck — that auto-cycle on a lit
stage with a **true vertex-level silhouette morph** between each one. Each
shape molds smoothly into the next; nothing crossfades, scales into a
puddle, or disappears mid-transition. The user can grab the canvas and
freely orbit the camera 360° to inspect the active object from any angle,
and **click anywhere on a mesh to poke it like jello** — the surface
ripples outward from the click point and settles back to rest.

Lives inside the [Gamma](https://github.com/heybrandonh1/Gamma) submodule and
mounts in Project Alpha's `/playground` page via `lib/playground-vibes.tsx`.

## How the morph works

The previous version of this vibe was a crossfade with a non-uniform
"puddle" pose — the outgoing mesh squashed flat, the incoming mesh
emerged from the same flat pose with an `elastic.out` rebound. Visually
that read as two distinct objects briefly overlapping and one of them
flickering out, not as one shape changing form. This rewrite replaces
that with an actual silhouette morph driven by per-vertex shader code.

Pipeline (see [`morph-shader.ts`](./morph-shader.ts) and
[`surface-distance.ts`](./surface-distance.ts)):

1. **Rest pose** — every body geometry (sphere, lathe, cylinder, prolate
   spheroid, truncated icosahedron, tube curves for seams / laces) is
   built in a shared **normalized orientation**: bat long axis along Y,
   football long axis along Z, hockey puck cylinder axis along X (the
   `rotation.z = π/2` lay-on-side is baked into the cylinder geometry,
   not the group). Aesthetic group rotations the previous design used
   are gone; `OrbitControls` covers camera angles.

2. **Per-vertex morph attributes** — at build time, each body geometry
   gets three custom attributes attached:
     - `aDirection` (`vec3`): unit vector from origin to the rest position.
     - `aRestDist` (`float`): length of the rest position.
     - `aTargetDist` (`float`): mutable; recomputed every morph cycle.

3. **Per-sport surface distance functions** — each sport exposes a
   `(dx, dy, dz) → distance` function that returns where a ray from the
   origin hits that sport's surface in object-local space:
     - Baseball / basketball / soccer ball: just the radius.
     - Football: iterative solve of the prolate spheroid + quartic taper.
     - Bat: closed-form solve through the lathe profile, segment by
       segment.
     - Hockey puck: capped-cylinder ray hit (whichever side or cap is
       closer).

4. **Vertex shader** (`attachSportShader` in
   [`morph-shader.ts`](./morph-shader.ts)) — replaces three.js's default
   `transformed = vec3(position)` with
   `transformed = aDirection · mix(aRestDist, aTargetDist,
   smoothstep(uMorphT))`. So when `uMorphT` is 0 the mesh is exactly at
   rest; when it's 1 the mesh's silhouette is the *target* sport's
   silhouette projected onto this mesh's vertex directions.

5. **Show controller** ([`show-controller.ts`](./show-controller.ts))
   wires the morph cycle:
     - Wires the OUTGOING mesh's `aTargetDist` to the INCOMING sport's
       `surfaceDist`, and the INCOMING mesh's `aTargetDist` to the
       OUTGOING sport's `surfaceDist`.
     - Tweens a single `t: 0 → 1` over the morph window, applied as
       `outgoing.uMorphT = t` and `incoming.uMorphT = 1 - t`.
     - Crossfades body opacity (`outgoing 1 → 0`, `incoming 0 → 1`) on
       the same curve.

   Because both meshes use the SAME pair of distance functions, their
   silhouettes coincide at every value of `t` (`mix(A, B, t)` ≡ `mix(A, B, t)`
   on both meshes). The opacity crossfade is therefore visually a no-op
   for the silhouette — the eye sees one continuously molding shape with
   the color smoothly interpolating from sport A to sport B. There is no
   puddle pose, no scale spring, and no moment where either body is
   invisible while the other hasn't taken over.

## What morphs and what fades

- **Bodies** of every sport — sphere, lathe, prolate spheroid, truncated
  icosahedron, capped cylinder — all carry the morph attributes and
  silhouette-morph between sports.
- **Body-attached decorations** that ride on regular meshes also morph:
  basketball seams (4 great-circle tubes), football lace strip + cross
  stitches, hockey puck rim band, soccer ball pentagon/hexagon panels.
  All of those use `TubeGeometry` / `BufferGeometry` and so have
  per-vertex attributes the silhouette morph can deform.
- **Instanced decorations** can't share vertex attributes across
  instances, so the baseball's 216 cross-stitches (an `InstancedMesh`)
  fade out at the start of the morph (~30%) and the new sport's
  decorations fade back in at the end (~70%). The body shape change is
  what dominates the visual story; the stitch fade is a minor accent.
- **Rim point-light tint** crossfades across the full morph window so
  the lighting morphs alongside the geometry.

## Anatomy

- [`surface-distance.ts`](./surface-distance.ts) — per-sport ray-from-origin
  distance functions used to drive the silhouette morph.
- [`morph-shader.ts`](./morph-shader.ts) — the per-vertex morph attributes,
  the `uMorphT` uniform, and the unified `attachSportShader` that splices
  both the silhouette morph and the click-to-jello jiggle into a single
  `MeshStandardMaterial` vertex stage. Splitting the two terms across
  two `onBeforeCompile` hooks would create a fragile dependency on
  three.js's exact replacement-string output, so they share one hook.
- [`mesh-builders.ts`](./mesh-builders.ts) — six builders (one per sport)
  that return a `SportMesh`: a `THREE.Group` plus `surfaceDist`,
  `setMorphTarget`, `setMorphProgress`, `setBodyOpacity`,
  `setDecorationOpacity`, spin axis + speed, click-to-jello hooks, and
  a `dispose` helper. All geometry is procedural — no textures, no GLTF
  assets.
  - `buildBaseball`: cream sphere body (morphs) + 216 red instanced
    cross-stitches (fade in/out).
  - `buildBat`: `LatheGeometry` swept from a 10-point bat profile (knob,
    handle, taper, barrel, rounded tip) — long axis along +Y.
  - `buildBasketball`: orange sphere + 4 dark seam tubes (1 horizontal,
    1 vertical, 2 tilted ±45°). Pebble bump map gives the leather grain;
    seams ride the silhouette morph on the same morph attributes.
  - `buildFootball`: `SphereGeometry` deformed into a prolate spheroid
    (z stretched 1.7×, quartic tip taper) + a thin white lace strip
    along the top with 7 perpendicular cross-stitches. Long axis along
    +Z. The previous version had aesthetic `rotation.z = π/14` and
    `rotation.x = -π/18` group tilts; those are removed (they would
    break silhouette alignment during the morph). The user can orbit to
    see the laces from a flattering angle.
  - `buildSoccerBall`: a real **truncated icosahedron** (32 faces — 12
    pentagons + 20 hexagons) constructed by truncating each
    icosahedron vertex at 1/3 along its 5 incident edges, then
    projecting all 60 vertices onto the sphere. A two-material `Mesh`
    colors the pentagons black and hexagons white via geometry face
    groups. Treated as a sphere of radius 0.9 by the morph.
  - `buildHockeyPuck`: short `CylinderGeometry` body + a thin sleeve
    cylinder around the rim. The "lay on its side" rotation
    (`rotation.z = π/2`) is **baked into the geometry** so the puck's
    cylinder axis is along +X — the silhouette morph queries surface
    distances in a shared world frame, so the orientation must live
    with the geometry, not above it.
- [`show-controller.ts`](./show-controller.ts) — owns the cycle. Replaces
  the previous puddle-crossfade with a true silhouette morph: configures
  both meshes' morph targets, drives a single shared `t: 0 → 1` over
  the morph window, crossfades body opacity, fades decorations at the
  morph boundaries, and tints the rim light along the way.
- [`jiggle.ts`](./jiggle.ts) — owns the **click-to-jello** wobble
  uniforms (click point, time-since-click, amplitude). The actual GLSL
  for the wobble lives in `morph-shader.ts` so it can layer correctly on
  top of the morphed position.
- [`sport-ball-morpher.tsx`](./sport-ball-morpher.tsx) — React component.
  Sets up the renderer, scene, camera, and lighting; generates a PMREM
  cubemap from `RoomEnvironment` so all `MeshStandardMaterial` surfaces
  pick up real image-based lighting; wires `OrbitControls` for free
  360° drag-to-rotate (zoom + pan disabled).

## Realism: PMREM environment

The single biggest visual upgrade over the bare-mesh version is the
PMREM-generated environment map:

```ts
const pmrem = new THREE.PMREMGenerator(renderer);
scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
```

`RoomEnvironment` is a procedural studio-style scene shipped in
`three/examples/jsm/environments`. PMREM converts it into a pre-filtered
cubemap that `MeshStandardMaterial` samples for image-based lighting.
Without it, the materials read flat. With it, every surface gets
believable reflections and shading falloff for free — no HDR asset
required.

## Interaction

- **Drag** anywhere on the canvas to rotate the camera 360° in any
  direction.
- **Click** any specific part of a mesh to poke it like jello — a damped
  wave radiates from the exact click point, wobbles outward, and settles
  back to rest in about a second. Drags are disambiguated from clicks by
  pointer travel distance (≤ 6 px) and press duration (≤ 350 ms), so
  orbiting and poking don't fight each other.
- **Pinch / scroll** is disabled (this is an inspection view, not a
  flythrough).
- The active mesh also auto-spins on its own axis; the orbit camera is
  independent so the user can hold a viewing angle while the object
  turns.
- The cycle auto-advances every ~3.0 s + ~1.4 s morph. `prefers-reduced-motion`
  pauses it.

## Accessibility

- `prefers-reduced-motion` pauses the cycle and the per-mesh spin.
- The mounted `<div>` carries `role="img"` with an `aria-label`
  describing the gallery and the drag interaction.
- The `<VibeFallback>` square is rendered when WebGL is missing or the
  renderer fails to initialize.
