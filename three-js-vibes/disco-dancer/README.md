# Disco Dancer

A Mixamo dancer in a tiered birthday cake hat, dancing on an ultraviolet blacklight tile floor. On mount, confetti rains down, a faceted chrome disco ball descends from above, and six colored ceiling spotlights kick on and start sweeping. Two background dancers periodically walk in from the wings, samba alongside the lead, and walk back out. From then on the show stays in club mode and confetti bursts again every ~25 s. Loops samba and occasionally erupts into a procedural break flourish.

## Usage

```tsx
import { DiscoDancer } from "@gamma/three-js-vibes/disco-dancer";

<DiscoDancer
  sambaUrl="/playground/three-js-vibes/disco-dancer/samba-dancing.fbx"
  reduceMotion={false}
/>
```

The component is a regular React client component; it owns its renderer, scene, mixer, controllers, and resize observer, and disposes everything on unmount.

## Props

| prop             | type                  | required | description                                                                  |
| ---------------- | --------------------- | -------- | ---------------------------------------------------------------------------- |
| `sambaUrl`       | `string`              | yes      | URL of the Samba Dancing FBX (Mixamo rig). Host app serves this from `/public`. |
| `breakdanceUrl`  | `string`              | no       | Optional second FBX. When provided, "break" mode crossfades into this clip instead of running the procedural overlay. |
| `reduceMotion`   | `boolean \| null`     | no       | When `true`, the show snaps to its steady-state visuals with no animation: ball at rest, lights on, no confetti, samba paused. |
| `disableBreaks`  | `boolean`             | no       | When `true`, the periodic break burst is suppressed entirely (no clip crossfade, no procedural spin / tilt / speed-up). The dancer just loops samba forever. Useful when the surrounding page wants a calmer, predictable loop. |
| `aspectRatio`    | `string`              | no       | CSS `aspect-ratio` for the canvas wrapper. Defaults to `1 / 0.72`.            |
| `className`      | `string`              | no       | Extra classes merged onto the canvas wrapper.                                |

## Behaviour

### Show timeline (intro on mount, then periodic bursts)

```text
t=0       mounted; samba already playing; ball hidden, lights off, no confetti
t=3000    burst confetti #1
t=8000    start ball descent (lerp y over 2s)
t=10000   ball at rest, spinning permanently; ramp club lights to full
t=12000+  steady state — confetti bursts every 25 s, ball + lights stay on
```

### Always-on beats

- **Samba loop** — the dancer's default state, the original Mixamo samba clip.
- **Break burst** — every 18–26 s the animation controller fires a ~4.5 s "break" segment:
  - if `breakdanceUrl` is set, it crossfades from samba → breakdance and back;
  - otherwise it boosts samba `timeScale` to ~1.6×, spins the root, and tilts forward, simulating a break style flourish on the existing clip.
  - pass `disableBreaks` to skip this beat entirely and keep the dancer on the samba loop.
- **Disco floor** — 16×16 grid of emissive tiles cycling through a strong ultraviolet palette (deep violet / electric purple / neon purple / hot magenta / electric magenta / UV pink) over a violet-tinted near-black base. Per-tile phase randomization keeps it shimmering rather than strobing, and the emissive cap is pushed up so the floor reads as a real blacklight stage.
- **Birthday cake hat** — a three-tier cake parented to the head bone: pink-frosting bottom, white-frosting middle with a magenta drip ring, chocolate top with a white drip + scattered sprinkles + five colored candles each topped with an additively-blended yellow-and-white flame.
- **Side dancers** — two background dancers (cloned from the lead via `SkeletonUtils.clone`, each on its own `AnimationMixer`) that periodically walk in from the wings, samba alongside the lead for ~8.5 s, then walk back out. Each wears a smaller cake hat, runs on a slightly jittered samba `timeScale` so they don't frame-lock with the lead, and has a randomized 9–16 s offstage gap so the two never sync up after the initial stagger.
- **Click to jump + jelly** — clicking the canvas hops the dancer (a 750 ms parabolic Y arc) *and* fires a damped cartoon squash-and-stretch on the FBX root's scale: Y compresses on impact, X / Z bulge outward to fake volume preservation, and a secondary out-of-phase Z term keeps the wobble looking organically jelly-like instead of mechanically symmetric. The whole-body wobble decays at `e^(-2.0·t)` so it rings out for ~2.5 s. Re-clicking refreshes the wobble (jump is still one-shot per cycle).

### Show beats (timed by `show-controller.ts`)

- **Confetti** — 220-piece InstancedMesh of small rectangular planes; physics integration on the CPU (gravity + drag + per-piece tumble). Hides itself between bursts so the GPU does no work.
- **Disco ball** — `IcosahedronGeometry` with `flatShading: true` for the mirror-facet look, `MeshStandardMaterial` at `metalness: 1, roughness: 0.08`, fed by a tiny PMREM env map of a colored gradient room so the facets actually reflect something. Suspended from a thin string with a chrome cap on top; warm `PointLight` at its center; spins forever.
- **Club lights** — six colored `SpotLight`s mounted at the implicit ceiling, each sweeping its target in an independent circle near the floor. Two cast shadows; the rest are decorative. Tiny emissive bulb meshes mark the lights' positions.

## Failure modes

If the browser doesn't support WebGL or `THREE.WebGLRenderer` throws on init,
the component renders the shared [`VibeFallback`](../_shared/vibe-fallback.tsx)
square in place of the canvas. The host app should additionally wrap the
component in an error boundary + `<noscript>` so chunk-load failures and
JS-disabled browsers see the same friendly square — see Alpha's
`<VibeErrorBoundary>` for an example.

## Accessibility

Honors `prefers-reduced-motion` via the `reduceMotion` prop. When it flips on:

- mixer is paused (no body animation),
- break-burst timer is suspended,
- floor tiles freeze,
- click-to-jump is a no-op,
- the show-controller snaps to steady state (ball at rest, lights on, no confetti) so the user still gets the "final picture" without animation.

The host app is expected to read `useReducedMotion()` (or equivalent) and pass it in.

## Adding a real breakdance FBX later

Drop a `breakdance.fbx` next to `samba-dancing.fbx` in the host's `/public` folder, then pass its URL in:

```tsx
<DiscoDancer
  sambaUrl="/.../samba-dancing.fbx"
  breakdanceUrl="/.../breakdance.fbx"
  reduceMotion={reduceMotion}
/>
```

The animation controller will switch to true clip-crossfade mode automatically. Because Mixamo rigs share bone names, no retargeting is required — the breakdance clip plays on the samba mesh.

## License notes

- The dancer mesh + samba animation FBX shipped in `assets/` is the same file used by the [three.js fbx loader example](https://threejs.org/examples/#webgl_loader_fbx) and is redistributed under the same terms.
- We deliberately do **not** ship a Mixamo breakdance FBX because Adobe's Mixamo TOS prohibits redistribution. Bring your own.
