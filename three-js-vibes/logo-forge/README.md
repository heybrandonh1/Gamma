# Logo Forge

A 3D showcase of six procedural sport-equipment meshes — baseball, bat,
basketball, football, soccer ball, hockey puck — that auto-cycle on a lit
stage with crossfade transitions. The user can grab the canvas and freely
orbit the camera 360° to inspect the active object from any angle.

Lives inside the [Gamma](https://github.com/heybrandonh1/Gamma) submodule and
mounts in Project Alpha's `/playground` page via `lib/playground-vibes.tsx`.

## Anatomy

- `mesh-builders.ts` — six builders (one per sport) that return a `SportMesh`:
  a `THREE.Object3D` (Group) plus `setOpacity` / `dispose` helpers and a spin
  axis + speed. All geometry is procedural — no textures, no GLTF assets.
  - `buildBaseball`: cream sphere + red `TubeGeometry` stitch curve
    parameterized as a wavy great circle (`φ = A·cos(2θ)`).
  - `buildBat`: `LatheGeometry` swept from a 10-point bat profile (knob,
    handle, taper, barrel, rounded tip).
  - `buildBasketball`: orange sphere + 4 dark seam tubes (1 horizontal great
    circle, 1 vertical great circle, 2 tilted great circles ±45°).
  - `buildFootball`: `SphereGeometry` deformed into a prolate spheroid (z
    stretched 1.7×, quartic taper at the tips) + a thin white lace strip
    along the top with 7 perpendicular cross-stitches.
  - `buildSoccerBall`: a real **truncated icosahedron** (32 faces — 12
    pentagons + 20 hexagons) constructed by truncating each icosahedron
    vertex at 1/3 along its 5 incident edges, then projecting all 60 vertices
    onto the sphere. A two-material `Mesh` colors the pentagons black and
    hexagons white via geometry face groups.
  - `buildHockeyPuck`: short `CylinderGeometry` body + a thin sleeve cylinder
    around the rim suggesting the embossed brand band, laid on its side.
- `show-controller.ts` — owns the cycle. GSAP-tweens opacity (via the
  `setOpacity` callback so multi-material soccer-ball faces all fade in
  lockstep), scale with a back-out overshoot, and crossfades the rim
  point-light color per active sport.
- `logo-forge.tsx` — React component. Sets up the renderer, scene, camera,
  and lighting; generates a PMREM cubemap from `RoomEnvironment` so all
  `MeshStandardMaterial` surfaces pick up real image-based lighting; wires
  `OrbitControls` for free 360° drag-to-rotate (zoom + pan disabled).

## Realism: PMREM environment

The single biggest visual upgrade over the bare-mesh version is the
PMREM-generated environment map:

```ts
const pmrem = new THREE.PMREMGenerator(renderer);
scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
```

`RoomEnvironment` is a procedural studio-style scene shipped in
`three/examples/jsm/environments`. PMREM converts it into a pre-filtered
cubemap that `MeshStandardMaterial` samples for image-based lighting. Without
it, the materials read flat. With it, every surface gets believable
reflections and shading falloff for free — no HDR asset required.

## Interaction

- **Drag** anywhere on the canvas to rotate the camera 360° in any direction.
- **Pinch / scroll** is disabled (this is an inspection view, not a flythrough).
- The active mesh also auto-spins on its own axis; the orbit camera is
  independent so the user can hold a viewing angle while the object turns.
- The cycle auto-advances every ~3.6 s. `prefers-reduced-motion` pauses it.

## Accessibility

- `prefers-reduced-motion` pauses the cycle and the per-mesh spin.
- The mounted `<div>` carries `role="img"` with an `aria-label` describing
  the gallery and the drag interaction.
- The `<VibeFallback>` square is rendered when WebGL is missing or the
  renderer fails to initialize.
