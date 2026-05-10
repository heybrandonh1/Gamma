# SSGI Sport Arena

A WebGPU "ball pool" — a 1:1 port of three.js's
[`webgpu_postprocessing_ssgi_ballpool`](https://threejs.org/examples/?q=ball#webgpu_postprocessing_ssgi_ballpool)
example, re-themed with **five sport-ball types** (baseball, basketball,
soccer ball, football, hockey puck) and a **procedural mannequin** standing
in the center of the room that gets bowled around as the balls slam into it.

Lives inside the [Gamma](https://github.com/heybrandonh1/Gamma) submodule and
mounts in Alpha's `/playground` page via `lib/playground-vibes.tsx`.

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
    20 hexagons) — same construction as Sport Ball Morpher but baked into a
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

## WebGPU → WebGL → static fallback cascade

The card lights up in three tiers depending on what the browser can do:

1. **WebGPU available** — `<SportArena />` runs the full SSGI + TRAA
   pipeline described above. This is the look the demo is designed
   around (Chromium 113+, Edge, Safari 26+ TP, Firefox Nightly).
2. **WebGPU missing or `renderer.init()` throws** — `<SportArena />`
   transparently mounts `<SportArenaWebGL />` (`sport-arena-webgl.tsx`)
   instead. That component is a plain `THREE.WebGLRenderer`
   reimplementation of the exact same simulation: same Bounce world, same
   walls, same five sport-ball families, same compound-shape mannequin,
   same pointer-push and respawn behavior. The only thing it can't do is
   screen-space global illumination — to compensate it baked a procedural
   `RoomEnvironment` through `PMREMGenerator` (so `MeshPhysicalMaterial`
   picks up image-based lighting on every surface) and adds a soft
   hemisphere + ambient pair on top of the original mouse-tracking
   shadow-casting `PointLight`. Visually it reads as a slightly less
   moody version of the WebGPU pipeline, but the simulation itself is
   bit-for-bit identical.
3. **WebGL also unavailable** (very old browsers, headless environments,
   in-app webviews with broken GL contexts) — the WebGL component itself
   falls back to the shared `<VibeFallback />` square so the playground
   card always occupies the same footprint and the page never errors.

`SportArenaWebGL` is also exported on its own from
[`./index.ts`](./index.ts), so callers that already know they want the
cheaper WebGL path (e.g., a low-power-mode toggle) can mount it directly
without going through the WebGPU detection at all.

## Interaction

- **Move** the cursor over the canvas to push nearby balls along the
  picking ray (also slides the shadow-casting light to your cursor).
- **Click and hold** (or two-finger tap) to respawn 5 random balls at the
  top of the room.

## Accessibility

- `prefers-reduced-motion` pauses physics integration and impulse pushes.
- The mounted `<div>` carries `role="img"` with an `aria-label` listing
  the sport-ball mix and the mannequin.
- Browsers without WebGPU automatically downgrade to the WebGL companion
  (`<SportArenaWebGL />`); browsers without WebGL get the static
  `<VibeFallback>` square.

## Why "heavy JS"

This is the most expensive vibe in the playground by a wide margin:

- 60 dynamic rigid bodies + 1 compound mannequin body, all colliding with
  walls and each other every frame.
- A WebGPU MRT pass writing four targets (color / diffuse / depth / normal /
  velocity) per pixel.
- Screen-space global illumination + AO sampling + temporal AA on top.

It's the demo we reach for when the question is "show me what a portfolio
WebGPU page can do".
