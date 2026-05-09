# Logo Forge

A particle morph engine that loads SVG silhouettes and stages them as a glowing
constellation of additively-blended sprites. Particles rush in from random 3D
spawn positions, settle into the silhouette of the first SVG, breathe gently
in place, then dissolve and re-converge into the next one.

Lives inside the [Gamma](https://github.com/heybrandonh1/Gamma) submodule and
mounts in Project Alpha's `/playground` page via `lib/playground-vibes.tsx`.

## Anatomy

- `svg-sampler.ts` — rasterizes an SVG to a 256² 2D canvas, samples N opaque
  pixels uniformly, and returns them in normalized `[-1, 1]` space. Works for
  any SVG (including ones with `fill-rule="evenodd"` cutouts).
- `particle-system.ts` — a `THREE.Points` cloud with a custom `ShaderMaterial`
  that renders each particle as a soft additive sprite (hot core + halo).
- `morph-controller.ts` — owns the cycle. Pre-loads all frames in parallel,
  GSAP-tweens positions + colors when advancing, and applies a small idle
  wobble while a logo is held.
- `league-data.ts` — the default sport cycle (baseball → basketball → football
  → soccer ball). Replace via the `frames` prop.
- `logo-forge.tsx` — React component. Owns the renderer, scene, and camera;
  delegates animation to the controller.

## Hosting the SVGs

The engine fetches SVGs over HTTP, so the host app must serve them. In Project
Alpha, `scripts/sync-gamma-assets.mjs` mirrors `assets/logos/` into
`public/playground/three-js-vibes/logo-forge/logos/` automatically before
`dev` and `build`.

## Swapping silhouettes

Drop any SVG into the logos folder and reference it via the `frames` prop:

```tsx
<LogoForge
  logosBaseUrl="/playground/three-js-vibes/logo-forge/logos"
  frames={[
    { url: "/your/path/sail-boat.svg", name: "Sailing", caption: "Wind & water", color: "#7dd3fc" },
    { url: "/your/path/skateboard.svg", name: "Skating", caption: "Concrete & wax", color: "#fb923c" },
  ]}
/>
```

Anything that rasterizes to an opaque silhouette on a transparent background
will work. Higher-detail SVGs read better when `particleCount` is bumped above
the default 3000.

## Accessibility

- `prefers-reduced-motion` snaps to the first frame and pauses the cycle.
- The mounted `<div>` carries `role="img"` and a live `aria-label` describing
  the active frame.
- The `<VibeFallback>` square is rendered when WebGL is missing or the
  renderer fails to initialize.
