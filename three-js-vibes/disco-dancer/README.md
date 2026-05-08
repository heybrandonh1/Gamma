# Disco Dancer

A Mixamo dancer holding a glowing golden key, wearing a party hat, on a subtle multi-color disco floor. Loops a samba and erupts into a "break" burst from time to time.

## Usage

```tsx
import { DiscoDancer } from "@gamma/three-js-vibes/disco-dancer";

<DiscoDancer
  sambaUrl="/playground/three-js-vibes/disco-dancer/samba-dancing.fbx"
  reduceMotion={false}
/>
```

The component is a regular React client component; it owns its renderer, scene, mixer, and resize observer, and disposes everything on unmount.

## Props

| prop             | type                  | required | description                                                                  |
| ---------------- | --------------------- | -------- | ---------------------------------------------------------------------------- |
| `sambaUrl`       | `string`              | yes      | URL of the Samba Dancing FBX (Mixamo rig). Host app serves this from `/public`. |
| `breakdanceUrl`  | `string`              | no       | Optional second FBX. When provided, "break" mode crossfades into this clip instead of running the procedural overlay. |
| `reduceMotion`   | `boolean \| null`     | no       | When `true`, all animation, swap timers, and floor shimmer are paused.       |
| `aspectRatio`    | `string`              | no       | CSS `aspect-ratio` for the canvas wrapper. Defaults to `1 / 0.72`.            |
| `className`      | `string`              | no       | Extra classes merged onto the canvas wrapper.                                |

## Behaviour

- **Samba loop** — the dancer's default state, looping the original Mixamo samba clip.
- **Break burst** — every 18–26 s the controller fires a ~4.5 s "break" segment:
  - if `breakdanceUrl` is set, it crossfades from samba → breakdance and back;
  - otherwise it boosts samba `timeScale` to ~1.6×, spins the root, adds a bouncy hop, and tilts forward, simulating a break style flourish on the existing clip.
- **Subtle disco floor** — 16×16 grid of tiles with low-intensity emissive cycling through six pastel colors. Each tile has a randomized phase so the floor reads as a slow shimmer rather than a strobe.
- **Party hat** — bright pastel cone + brim torus + pompom, attached to the head bone.
- **Golden key** — same chunky gold key the dancer carried in the original Project Alpha gate page, parented to the right (or left) hand bone.
- **Click to jump** — the dancer hops on tap (preserved from the original).

## Accessibility

Honors `prefers-reduced-motion` via the `reduceMotion` prop:

- mixer is paused (no body animation),
- break-burst timer is suspended,
- floor tiles freeze on their initial palette index,
- click-to-jump is a no-op.

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
