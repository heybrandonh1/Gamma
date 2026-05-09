# Wizard's Zork PC

An old beige CRT on a wizard's wood table runs Zork I in amber phosphor
while runes pulse around the rim, two candles flicker in real time, a
transmissive crystal orb spins on the corner, and ember/dust particles
drift overhead. The terminal auto-types Zork I's opening, walks through
a small demo (`open mailbox` → `read leaflet` → `north`), then opens a
blinking prompt that accepts a handful of canned commands. After ~12 s
of no input the show loops back to the opening.

## Usage

```tsx
import { WizardZorkPc } from "@gamma/three-js-vibes/wizard-zork-pc";

<WizardZorkPc reduceMotion={false} aspectRatio="1 / 0.72" />
```

The component is a regular React client component; it owns its
renderer, scene, post-processing composer, orbit controls, hidden
input element, and every subsystem controller, and disposes
everything on unmount.

## Props

| prop          | type             | required | description                                                                  |
| ------------- | ---------------- | -------- | ---------------------------------------------------------------------------- |
| `reduceMotion`| `boolean \| null`| no       | When `true`, lines paint instantly (no per-char typing), candles steady, particles frozen, orb stops rotating, no auto-orbit. |
| `aspectRatio` | `string`         | no       | CSS `aspect-ratio` for the canvas wrapper. Defaults to `1 / 0.72`.            |
| `className`   | `string`         | no       | Extra classes merged onto the canvas wrapper.                                |

## Behaviour

### Show timeline

```text
phase     duration   what happens
boot      0..600 ms  CRT emissive ramps 0 -> 1; candles, orb, runes already alive
opening   ~7 s       OPENING block types into the terminal (per-char with jitter)
demo      ~10 s      AUTO_DEMO walks through 3 commands as if typed
prompt    open       caret blinks, accepts user input, idle timer running
prompt    +12 s idle loop returns to opening
```

### Camera

`OrbitControls` is configured with rotate-only + scroll-to-zoom
(unlike the other vibes, which disable zoom — reading the CRT
terminal is the whole point of this one). Zoom is bounded to
`minDistance: 2.2` (close enough to fill the frame with the screen)
and `maxDistance: 9.0` (so visitors don't punt the camera into
empty space). Pan is still disabled. `autoRotate` is on by default
and toggles off under `reduceMotion`.

### Hybrid input

Click the canvas (or tap on touch) to focus a hidden `<input>` —
that's how on-screen keyboards open on iOS / Android. From then on,
`keydown` events route into the show controller's pending prompt
line. The visible caret is the canvas terminal's painted block, not
the real input's cursor.

Recognised commands (lowercased, trimmed): `open mailbox`,
`take leaflet`, `read leaflet`, `inventory` / `i`, `look` / `l`,
`north` / `n`, `south` / `s`, `east` / `e`, `west` / `w`, `up`,
`down`, `enter house`, `xyzzy`, `score`, `help` / `?`, `quit` / `q`.
Anything else echoes "I don't understand that."

Hammering a key during the autoplay snaps the show to a fresh
prompt so input doesn't get dropped or interleaved with the
auto-typed text.

## Reduce-motion

When `prefers-reduced-motion` is on (or the host passes
`reduceMotion`), the show keeps running but loses everything that
moves: per-line paints replace per-char typing, candles pin at full
brightness with no flicker, the rune ring's emissive locks to the
median, particles freeze in place, the crystal orb stops rotating
and bobbing, and the camera no longer auto-orbits.

## Three.js examples this leans on

The user's only direction was "use three.js examples out there in the
internet to help with the code", so each subsystem is modelled on a
well-known threejs.org example:

| subsystem               | example                                       |
| ----------------------- | --------------------------------------------- |
| post-processing pipeline| `webgl_postprocessing_unreal_bloom`           |
| CRT screen shader       | the standard "CRT post" recipe (barrel UV warp + RGB split + scanlines), inlined as a `ShaderMaterial` |
| crystal orb material    | `webgl_materials_physical_transmission`       |
| ember + dust particles  | `webgl_points_sprites`                        |
| camera controls         | `misc_controls_orbit`                         |
| IBL fill                | `RoomEnvironment` (same as sport-ball-morpher)|

No WebGPU / TSL anywhere in this vibe, so the host's existing CSP is
sufficient — no `'unsafe-eval'` escalation needed beyond what the
SSGI Sport Arena vibe already required.

## Files

```
wizard-zork-pc/
├── README.md             # this file
├── index.ts              # re-exports the React component
├── wizard-zork-pc.tsx    # the React mount: renderer + scene + composer + controllers
├── show-controller.ts    # boot ramp -> opening -> demo -> prompt -> idle loop
├── input-controller.ts   # hidden <input>, keydown wiring, mobile keyboard support
├── terminal-buffer.ts    # CanvasTexture-backed amber terminal with blinking caret
├── crt-screen.ts         # bulged plane + custom CRT ShaderMaterial
├── pc-chassis.ts         # beige CRT monitor + tower + power LEDs
├── wizard-table.ts       # wood table top + animated rune emissive ring
├── candles.ts            # lathe wax + flame cones + flickering point lights
├── crystal-orb.ts        # subdivided octahedron + transmissive PBR + violet inner light
├── magic-particles.ts    # additive sprite ember + dust clouds
└── zork-script.ts        # OPENING text, AUTO_DEMO sequence, COMMAND_MAP
```
