# Disco Dancer

A trio of Mixamo pirates — black tricorn hats, eyepatches, parrots on the shoulder, brass-and-steel cutlasses in hand, and red sashes across the torso — sambaing on a classic disco-club floor while a high-facet diamond mirror ball spins overhead with iridescent thin-film shimmer and a halo of twinkling sparkles. On mount, confetti rains down, the ball descends from above, and six colored ceiling spotlights kick on and start sweeping. Two background pirate dancers periodically walk in from the wings, samba alongside the lead, and walk back out. From then on the show stays in club mode and confetti bursts again every ~25 s. The lead loops samba and occasionally erupts into a procedural break flourish.

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
- **Disco floor** — 16×16 grid of emissive tiles cycling through a classic disco-club palette (party red / tangerine / sunshine yellow / electric lime / sky-blue / hot bubblegum pink) over a charcoal base. Per-tile phase randomization keeps it shimmering rather than strobing.
- **Pirate outfit** — the `pirate-outfit` module attaches a full costume to a Mixamo rig: a black tricorn hat with a gold-trimmed brim, three folded-up wings, a white skull-and-crossbones patch and a red plume rising from the back; a leather eyepatch with a strap across the head; a colorful parrot (green body, red head, yellow beak, blue wings, multi-colored tail) perched on the left-shoulder bone; a brass-and-steel cutlass parented to the right-hand bone with a curved D-guard, wood handle, and brass pommel; and a red diagonal sash across the spine. The body materials are tinted toward navy so the bare Mixamo skin reads as a pirate's coat (revertible on dispose, since the tint is shared with the SkeletonUtils-cloned side dancers).
- **Side dancers** — two background pirates (cloned from the lead via `SkeletonUtils.clone`, each on its own `AnimationMixer`) that periodically walk in from the wings, samba alongside the lead for ~8.5 s, then walk back out. Each gets a smaller pirate outfit (scale 0.72) without re-tinting the body — that tint is already shared via the cloned materials. Their samba `timeScale` is slightly jittered so they don't frame-lock with the lead, and they have a randomized 9–16 s offstage gap so the two never sync up after the initial stagger.
- **Click to jump + jelly** — clicking the canvas hops the dancer (a 750 ms parabolic Y arc) *and* fires a damped cartoon squash-and-stretch on the FBX root's scale: Y compresses on impact, X / Z bulge outward to fake volume preservation, and a secondary out-of-phase Z term keeps the wobble looking organically jelly-like instead of mechanically symmetric. The whole-body wobble decays at `e^(-2.0·t)` so it rings out for ~2.5 s. Re-clicking refreshes the wobble (jump is still one-shot per cycle).

### Show beats (timed by `show-controller.ts`)

- **Confetti** — 220-piece InstancedMesh of small rectangular planes; physics integration on the CPU (gravity + drag + per-piece tumble). Hides itself between bursts so the GPU does no work.
- **Disco ball** — high-detail `IcosahedronGeometry` (subdivision 3 → 320 triangles) with `flatShading: true` for the dense diamond-mirror facet look. `MeshPhysicalMaterial` at `metalness: 1, roughness: 0.02` with a thin-film `iridescence` layer (IOR 1.35, thickness 120–520 nm) so each facet picks up a faint rainbow shimmer at glancing angles. Fed by a tiny PMREM env map of a colored gradient room so the facets reflect something even before the spotlights kick on. A halo of 96 small additive `Points` orbits the ball at slightly varied radii; each point's brightness flashes on its own phase (skewed dim with sharp peaks via `max(sin, 0) ^ 4`), tinted white / warm / cool, so the ball reads as glittering rather than uniformly bright. Suspended from a thin string with a chrome cap on top; warm `PointLight` at its center; spins forever.
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
