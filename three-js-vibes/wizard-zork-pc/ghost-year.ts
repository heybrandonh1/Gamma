import * as THREE from "three";

/**
 * Massive "1978" backdrop — four enormous digits floating behind the
 * wizard's table. Each digit drifts in one at a time as a smoky,
 * ghostly apparition, holds together once the year is fully spelled,
 * then unravels back into smoke one digit at a time before the cycle
 * loops.
 *
 * Why 1978? It's the year of the original mainframe Zork — the era
 * the rest of the scene (beige CRT, amber phosphor, candles in a
 * rune circle) is conjuring. The digits sit far behind the table
 * inside the scene's fog band, so they read more as a memory than as
 * solid signage.
 *
 * Implementation
 * --------------
 * Each digit is a single billboarded plane sampling a soft, blurred
 * canvas glyph. A {@link THREE.ShaderMaterial} with `transparent: true`
 * and `AdditiveBlending`:
 *
 *   * displaces UVs with two octaves of value-noise (drifts upward
 *     over time so the figure looks like rising smoke);
 *   * fades in/out via a per-digit `uOpacity` that animates with an
 *     ease curve plus a noise-modulated dissolve mask so the digit
 *     reveals/dissolves unevenly rather than as a clean cross-fade;
 *   * tints to a faint phosphor green (matches the CRT) so the
 *     bloom pass picks it up the same way it picks up the candles
 *     and screen.
 *
 * Geometry-side: each plane has 12×16 segments so the vertex shader
 * can add a low-amplitude vertical sway, giving the smoke a hint of
 * volumetric drift even as the digit holds in place.
 *
 * `reduceMotion` pins the cycle clock so whatever digits were last
 * visible stay visible at their last `uOpacity` — no fade churn for
 * vestibular-sensitive visitors.
 */

export interface GhostYear {
  readonly object: THREE.Group;
  setReducedMotion(reduced: boolean): void;
  tick(deltaSeconds: number): void;
  dispose(): void;
}

export interface GhostYearOptions {
  /** Year string to render — left-to-right. Defaults to "1978". */
  year?: string;
  /** World-space centre of the backdrop block (typically far behind the table). */
  center: THREE.Vector3;
  /** Height of each digit in world units. */
  digitHeight?: number;
  /** Spacing between digit centres, as a multiple of digit height. */
  digitSpacing?: number;
  /** Total length of one full appear → hold → vanish loop, in seconds. */
  cycleSeconds?: number;
}

interface DigitEntry {
  readonly mesh: THREE.Mesh;
  readonly material: THREE.ShaderMaterial;
  readonly geometry: THREE.PlaneGeometry;
  readonly texture: THREE.CanvasTexture;
  /** Index in the year string — drives the per-digit phase offset. */
  readonly order: number;
}

/**
 * Draw a single digit on a transparent canvas with a soft white
 * glow so the shader can re-tint it at runtime. The blur and stroke
 * thickness here matter as much as the font face — a hard-edged
 * glyph does not read as smoke even with shader displacement on top.
 */
function buildDigitTexture(digit: string): THREE.CanvasTexture {
  const size = 512;
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("ghost-year: 2D context unavailable");

  ctx.clearRect(0, 0, size, size);
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.font =
    "900 420px ui-serif, 'Iowan Old Style', 'Palatino Linotype', Georgia, serif";

  // Outer halo: very wide, low-alpha glow so the digit dissolves into
  // the surrounding plane rather than ending in a sharp silhouette.
  ctx.shadowColor = "rgba(255, 255, 255, 0.55)";
  ctx.shadowBlur = 64;
  ctx.fillStyle = "rgba(255, 255, 255, 0.85)";
  ctx.fillText(digit, size / 2, size / 2 + 18);

  // Inner core: tighter blur, opaque centre — gives the digit body
  // weight so it isn't pure mist.
  ctx.shadowColor = "rgba(255, 255, 255, 0.95)";
  ctx.shadowBlur = 18;
  ctx.fillStyle = "rgba(255, 255, 255, 1)";
  ctx.fillText(digit, size / 2, size / 2 + 18);

  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.minFilter = THREE.LinearFilter;
  tex.magFilter = THREE.LinearFilter;
  tex.anisotropy = 4;
  tex.needsUpdate = true;
  return tex;
}

const VERT = /* glsl */ `
  varying vec2 vUv;
  uniform float uTime;
  uniform float uReduced;

  void main() {
    vUv = uv;
    vec3 p = position;
    // Gentle vertical sway so the glyph plane reads as drifting
    // smoke rather than a flat decal. Frozen on reduceMotion.
    float sway = sin(uTime * 0.6 + position.x * 1.4) * 0.04
               + cos(uTime * 0.4 + position.y * 0.9) * 0.03;
    p.y += sway * (1.0 - uReduced);
    p.x += sin(uTime * 0.3 + position.y * 0.8) * 0.02 * (1.0 - uReduced);
    gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.0);
  }
`;

const FRAG = /* glsl */ `
  precision highp float;

  varying vec2 vUv;

  uniform sampler2D uTex;
  uniform float uTime;
  uniform float uOpacity;
  uniform float uDissolve;
  uniform vec3  uColor;

  // 2D value noise — same recipe as classic shadertoy hash/noise
  // pairings. Cheap and good enough for a smoke displacement.
  float hash(vec2 p) {
    return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453);
  }
  float vnoise(vec2 p) {
    vec2 i = floor(p);
    vec2 f = fract(p);
    vec2 u = f * f * (3.0 - 2.0 * f);
    return mix(
      mix(hash(i + vec2(0.0, 0.0)), hash(i + vec2(1.0, 0.0)), u.x),
      mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), u.x),
      u.y
    );
  }
  float fbm(vec2 p) {
    float v = 0.0;
    float a = 0.5;
    for (int i = 0; i < 4; i++) {
      v += a * vnoise(p);
      p *= 2.0;
      a *= 0.5;
    }
    return v;
  }

  void main() {
    // Smoke flows upward — bias the noise lookup with -uTime on Y.
    vec2 flow = vec2(uTime * 0.05, -uTime * 0.18);
    float n  = fbm(vUv * 3.0 + flow);
    float n2 = fbm(vUv * 6.0 - flow * 1.3);

    // UV displacement: stronger near the dissolve (entry/exit) so the
    // glyph "blurs apart" before it disappears.
    float dissolveStrength = mix(0.02, 0.10, uDissolve);
    vec2 displaced = vUv + vec2(n - 0.5, n2 - 0.5) * dissolveStrength;

    vec4 tex = texture2D(uTex, displaced);

    // Mask the glyph against a noise field driven by uDissolve. As
    // the digit fades in (uDissolve goes 1 → 0) the mask reveals
    // more of the glyph. As it fades out (uDissolve climbs back to
    // 1) the mask eats the glyph from the inside, so it dissolves
    // unevenly instead of dimming uniformly — the bit that sells the
    // ghostly fade-in / fade-out of each numeral.
    float mask = smoothstep(uDissolve - 0.25, uDissolve + 0.25, n);

    // Brightness wobble so the digit pulses softly while held.
    float pulse = 0.85 + 0.15 * fbm(vUv * 2.0 + vec2(0.0, uTime * 0.1));

    float a = tex.a * mask * uOpacity * pulse;
    if (a < 0.002) discard;

    gl_FragColor = vec4(uColor * pulse, a);
  }
`;

/**
 * Schedule for one digit: it appears, holds, then vanishes inside
 * the current cycle. Each digit's `appearStart` is staggered by its
 * order in the year string so the year spells out left-to-right;
 * `vanishStart` follows the same staggered order so the year
 * un-spells the same way.
 */
function digitTimeline(
  cycleT: number,
  order: number,
  count: number,
  cycle: number,
) {
  // Carve the cycle into three rough acts:
  //   appearWindow   – stagger fade-ins across the first 35%
  //   holdWindow     – fully visible across the middle 25%
  //   vanishWindow   – stagger fade-outs across the last 40%
  // The appear/vanish windows overlap the holds slightly so the year
  // never has a "dead" frame where every digit is already-fading-but-
  // not-yet-faded; there's always at least one digit at full bloom.
  const appearStartOf = (i: number) => cycle * 0.04 + (cycle * 0.32 * i) / count;
  const vanishStartOf = (i: number) =>
    cycle * 0.6 + (cycle * 0.32 * i) / count;
  const fadeDuration = cycle * 0.18;

  const appearStart = appearStartOf(order);
  const vanishStart = vanishStartOf(order);

  const appearProgress = THREE.MathUtils.clamp(
    (cycleT - appearStart) / fadeDuration,
    0,
    1,
  );
  const vanishProgress = THREE.MathUtils.clamp(
    (cycleT - vanishStart) / fadeDuration,
    0,
    1,
  );

  // Smoothstep both ends so the digit eases into existence rather
  // than ramping linearly.
  const appearEase = appearProgress * appearProgress * (3 - 2 * appearProgress);
  const vanishEase = vanishProgress * vanishProgress * (3 - 2 * vanishProgress);

  const opacity = THREE.MathUtils.clamp(appearEase - vanishEase, 0, 1);
  // `dissolve` rides high while the glyph is mid-transition (the
  // shader's noise mask carves the digit apart) and dips low while
  // it's held steady (mask stops biting and the digit reads cleanly).
  const transitionEnergy = Math.max(
    appearProgress * (1 - appearProgress) * 4,
    vanishProgress * (1 - vanishProgress) * 4,
  );
  const dissolve = THREE.MathUtils.clamp(
    0.25 + transitionEnergy * 0.7 + (1 - opacity) * 0.2,
    0,
    1,
  );

  return { opacity, dissolve };
}

export function createGhostYear(opts: GhostYearOptions): GhostYear {
  const year = opts.year ?? "1978";
  const digitHeight = opts.digitHeight ?? 4.6;
  const digitSpacing = opts.digitSpacing ?? 0.78;
  const cycle = opts.cycleSeconds ?? 14;

  const group = new THREE.Group();
  group.name = "ghost-year";
  // Render before the foreground so the bloom pass picks the digits
  // up but the table/CRT still composit cleanly on top of them.
  group.renderOrder = -1;

  const digits: DigitEntry[] = [];
  const aspect = 1.0; // square texture, plane width follows height
  const totalWidth = (year.length - 1) * digitHeight * digitSpacing;

  for (let i = 0; i < year.length; i++) {
    const ch = year[i];
    const texture = buildDigitTexture(ch);
    const geometry = new THREE.PlaneGeometry(
      digitHeight * aspect,
      digitHeight,
      12,
      16,
    );

    const material = new THREE.ShaderMaterial({
      uniforms: {
        uTex: { value: texture },
        uTime: { value: 0 },
        uOpacity: { value: 0 },
        uDissolve: { value: 1 },
        uReduced: { value: 0 },
        uColor: { value: new THREE.Color("#cdb6ff") },
      },
      vertexShader: VERT,
      fragmentShader: FRAG,
      transparent: true,
      depthWrite: false,
      depthTest: true,
      blending: THREE.AdditiveBlending,
      // Don't let the scene fog eat the digits — the shader already
      // dims them through the dissolve mask, and adding fog on top
      // makes the held year almost invisible.
      fog: false,
    });

    const mesh = new THREE.Mesh(geometry, material);
    const x = -totalWidth / 2 + i * digitHeight * digitSpacing;
    mesh.position.set(opts.center.x + x, opts.center.y, opts.center.z);
    mesh.frustumCulled = false;
    group.add(mesh);

    digits.push({ mesh, material, geometry, texture, order: i });
  }

  let reduced = false;
  let cycleT = 0;

  return {
    object: group,
    setReducedMotion(v: boolean) {
      reduced = v;
      for (const d of digits) {
        d.material.uniforms.uReduced.value = v ? 1 : 0;
      }
    },
    tick(delta: number) {
      if (!reduced) {
        cycleT = (cycleT + delta) % cycle;
      }
      for (const d of digits) {
        const { opacity, dissolve } = digitTimeline(
          cycleT,
          d.order,
          year.length,
          cycle,
        );
        d.material.uniforms.uOpacity.value = opacity;
        d.material.uniforms.uDissolve.value = dissolve;
        d.material.uniforms.uTime.value += delta;
      }
    },
    dispose() {
      for (const d of digits) {
        d.geometry.dispose();
        d.material.dispose();
        d.texture.dispose();
      }
    },
  };
}
