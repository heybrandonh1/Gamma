# SSGI Sport Arena

A WebGPU "ball pool" — a 1:1 port of three.js's
[`webgpu_postprocessing_ssgi_ballpool`](https://threejs.org/examples/?q=ball#webgpu_postprocessing_ssgi_ballpool)
example, re-themed with **five sport-ball types** (baseball, basketball,
soccer ball, football, hockey puck) and a **procedural mannequin** standing
in the center of the room that gets bowled around as the balls slam into it.

Lives inside the [Gamma](https://github.com/heybrandonh1/Gamma) submodule and
mounts in Project Alpha's `/playground` page via `lib/playground-vibes.tsx`.

## Anatomy

- `sport-balls.ts` — geometry / material builders for each sport-ball type.
  Every ball type emits a **single merged `BufferGeometry`** (sphere/body +
  decorative tubes baked in) with material groups so we can render each
  family with one `THREE.InstancedMesh`. No textures, no external assets —
  every seam, lace, panel, and rim band is procedural geometry.

  - `buildBaseballSpec`: cream sphere + red figure-8 stitch tube
    (`φ = A·cos(2θ)` great-circle). Two material groups (skin, seam).
  - `buildBasketballSpec`: orange sphere + 4 dark seam tubes (equator,
    perpendicular great circle, two ±45° great circles). Two material
    groups (skin, seam).
  - `buildSoccerBallSpec`: real **truncated icosahedron** (12 pentagons +
    20 hexagons) — same construction as Logo Forge but baked into a
    self-contained spec for instancing. Two material groups (black panels,
    white panels).
  - `buildFootballSpec`: prolate spheroid (sphere stretched on z + tip
    pinch) + a white lace strip and 7 cross-stitches along the top. Two
    material groups (leather, laces).
  - `buildHockeyPuckSpec`: short `CylinderGeometry` body + a thin sleeve
    cylinder for the rim band. Two material groups (body, band).
    Uses a Bounce **`Cylinder`** collider (not a sphere) so it lies flat
    on its faces and slides naturally.

- `mannequin.ts` — procedural humanoid mannequin. Visual is a `THREE.Group`
  of primitives (head sphere, torso capsule, pelvis sphere, two arms, two
  legs, two foot boxes, joint accent spheres) parented to one root, all
  with a soft sheen `MeshPhysicalMaterial`. Physics is a single Bounce
  dynamic body holding a **`CompoundShape`** of five sub-shapes (head
  sphere + torso capsule + pelvis sphere + two leg capsules) so ball
  contacts feel right along the silhouette without us paying for a true
  ragdoll. As balls hit, the whole figure tumbles as a unit and the visual
  group syncs to `body.position` / `body.orientation` every frame.

- `sport-arena.tsx` — the React component. Mirrors the upstream WebGPU
  example almost line-for-line:

  - `THREE.WebGPURenderer` + `THREE.RenderPipeline` with an MRT pass that
    exports `output`, `diffuseColor`, encoded `normalView`, and
    per-pixel `velocity` G-buffers.
  - **SSGI** post-pass (`three/addons/tsl/display/SSGINode`) consuming the
    color, depth, and decoded normal textures for screen-space global
    illumination + AO.
  - **TRAA** post-pass (`three/addons/tsl/display/TRAANode`) for stable
    temporal anti-aliasing on top of the SSGI composite.
  - Composite formula `color * ao + diffuse * gi`, identical to the example.
  - Single shadow-casting `PointLight` whose position lerps toward the
    pointer's intersection with the front plane (matches the example's
    `mouseLight` ease).
  - Bounce `World` with the same gravity / iteration / damping defaults,
    plus a wall set (floor, ceiling, back, invisible front, red left,
    green right) — only the swap is the dynamic content (sport balls +
    mannequin instead of the example's colored sphere instances).

## WebGPU + fallback

The vibe **requires WebGPU**. If `navigator.gpu` is missing or
`renderer.init()` fails (older browser, no compatible adapter, blocked by
policy, etc.), the component renders the shared `<VibeFallback />` square so
the playground card stays the same size and the page never errors.

## Interaction

- **Move** the cursor over the canvas to push nearby balls along the
  picking ray (also slides the shadow-casting light to your cursor).
- **Click and hold** (or two-finger tap) to respawn 5 random balls at the
  top of the room.

## Accessibility

- `prefers-reduced-motion` pauses physics integration and impulse pushes.
- The mounted `<div>` carries `role="img"` with an `aria-label` listing
  the sport-ball mix and the mannequin.
- A `<VibeFallback>` square renders for browsers without WebGPU support.

## Why "heavy JS"

This is the most expensive vibe in the playground by a wide margin:

- 60 dynamic rigid bodies + 1 compound mannequin body, all colliding with
  walls and each other every frame.
- A WebGPU MRT pass writing four targets (color / diffuse / depth / normal /
  velocity) per pixel.
- Screen-space global illumination + AO sampling + temporal AA on top.

It's the demo we reach for when the question is "show me what a portfolio
WebGPU page can do".
