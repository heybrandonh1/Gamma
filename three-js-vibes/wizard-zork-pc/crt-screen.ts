import * as THREE from "three";

/**
 * The CRT face plane.
 *
 * Geometry: a `PlaneGeometry` whose vertices are pushed forward along
 * +Z with a quadratic falloff so the centre bulges out 3 mm and the
 * corners sit flush against the bezel — same trick the threejs.org
 * curved-monitor / video-panorama examples use to fake CRT glass.
 *
 * Material: a custom `ShaderMaterial`. The fragment shader is the
 * standard "CRT post" recipe distilled into a single sample step:
 *   1. barrel-warp the UV so we look through a slight fish-eye
 *   2. mask out anything that lands outside [0,1]^2 after the warp
 *   3. RGB-split the texture sample (chromatic aberration)
 *   4. multiply by a high-frequency scanline term
 *   5. apply a soft vignette + corner mask
 *   6. lift through `uEmissive` so `UnrealBloomPass` blooms the bright
 *      pixels (text, prompt, caret) and ignores the dim background.
 *
 * The material is `transparent: false` because the CRT plane sits in
 * front of the bezel and we want the masked corners to read as the
 * bezel's beige plastic, not the background sky — the masked region
 * just falls back to a near-black "off pixel" colour that visually
 * blends with the surrounding chassis.
 */

export interface CrtScreen {
  readonly mesh: THREE.Mesh;
  readonly material: THREE.ShaderMaterial;
  /** Boot ramp: 0 = screen off, 1 = full brightness. */
  setEmissive(value: number): void;
  setReducedMotion(reduced: boolean): void;
  tick(deltaSeconds: number): void;
  dispose(): void;
}

export interface CrtScreenOptions {
  /** The amber-phosphor source texture from `terminal-buffer`. */
  texture: THREE.Texture;
  /** Width of the screen plane in world units. */
  width: number;
  /** Height of the screen plane in world units. */
  height: number;
}

const VERT = /* glsl */ `
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

const FRAG = /* glsl */ `
  precision highp float;
  uniform sampler2D uMap;
  uniform float uTime;
  uniform float uEmissive;
  uniform float uAberration;
  varying vec2 vUv;

  void main() {
    // Barrel-warp the UV so it reads as curved glass.
    vec2 centred = vUv * 2.0 - 1.0;
    float r2 = dot(centred, centred);
    centred *= 1.0 + 0.06 * r2;
    vec2 warped = centred * 0.5 + 0.5;

    // Anything that warps off the canvas reads as "off pixel" — the
    // tube's dark glass beyond the visible raster.
    vec2 outside = step(vec2(1.0), warped) + step(warped, vec2(0.0));
    float mask = 1.0 - clamp(outside.x + outside.y, 0.0, 1.0);

    // Chromatic aberration — sample R, G, B with tiny radial offsets.
    vec2 dir = centred;
    float aber = uAberration;
    vec3 col;
    col.r = texture2D(uMap, warped + dir * 0.0030 * aber).r;
    col.g = texture2D(uMap, warped + dir * 0.0000 * aber).g;
    col.b = texture2D(uMap, warped - dir * 0.0030 * aber).b;

    // Scanlines — high-frequency cosine on V, mild amplitude.
    float scan = 0.88 + 0.12 * sin(warped.y * 700.0 + uTime * 6.0);
    col *= scan;

    // Vignette + soft corner roll.
    float vign = smoothstep(1.4, 0.4, length(centred));
    col *= vign;

    // Lift bright pixels just above 1.0 so UnrealBloomPass picks up
    // the prompt / caret / typed glyphs but doesn't wash the whole
    // body of text into a single bright smear. Earlier we doubled
    // bright pixels with a quadratic boost — that fought legibility
    // on every readable line, so the boost is gone now and the
    // emissive multiplier alone (boot ramp) is what feeds the bloom.
    col *= uEmissive * 1.05;

    col *= mask;

    gl_FragColor = vec4(col, 1.0);
  }
`;

export function createCrtScreen(opts: CrtScreenOptions): CrtScreen {
  const { texture, width, height } = opts;

  const SEGS_X = 32;
  const SEGS_Y = 24;
  const geometry = new THREE.PlaneGeometry(width, height, SEGS_X, SEGS_Y);
  // Bulge: push each vertex forward proportional to (1 - r^2) of its
  // normalised plane position. Max bulge ~3 mm for a ~36 cm screen.
  const positions = geometry.attributes.position as THREE.BufferAttribute;
  const halfW = width / 2;
  const halfH = height / 2;
  for (let i = 0; i < positions.count; i++) {
    const x = positions.getX(i) / halfW; // [-1, 1]
    const y = positions.getY(i) / halfH;
    const r2 = x * x + y * y;
    const bulge = Math.max(0, 1 - r2) * 0.04;
    positions.setZ(i, bulge);
  }
  positions.needsUpdate = true;
  geometry.computeVertexNormals();

  const material = new THREE.ShaderMaterial({
    vertexShader: VERT,
    fragmentShader: FRAG,
    uniforms: {
      uMap: { value: texture },
      uTime: { value: 0 },
      uEmissive: { value: 0 },
      uAberration: { value: 1 },
    },
    transparent: false,
    side: THREE.FrontSide,
  });

  const mesh = new THREE.Mesh(geometry, material);
  mesh.castShadow = false;
  mesh.receiveShadow = false;

  let reduced = false;

  return {
    mesh,
    material,
    setEmissive(v: number) {
      material.uniforms.uEmissive.value = v;
    },
    setReducedMotion(v: boolean) {
      reduced = v;
      // When reduce-motion is on, freeze the time uniform so the
      // scanline phase stops drifting (still scrolling-but-static).
      if (reduced) material.uniforms.uTime.value = 0;
    },
    tick(delta: number) {
      if (reduced) return;
      material.uniforms.uTime.value += delta;
    },
    dispose() {
      geometry.dispose();
      material.dispose();
    },
  };
}
