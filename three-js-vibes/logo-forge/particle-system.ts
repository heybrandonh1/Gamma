import * as THREE from "three";

/**
 * A single Points cloud where each particle has a current position, a target
 * position (driven by the morph controller), and a per-particle color so the
 * "league" tint can crossfade smoothly per particle without rebuilding the
 * geometry.
 *
 * Sprite is a soft circular gradient drawn in the fragment shader (cheaper
 * than uploading a texture, and the falloff curve is tunable).
 */
export interface ParticleSystem {
  points: THREE.Points;
  count: number;
  /** Current XYZ — what the renderer reads. The morph controller mutates this. */
  positions: Float32Array;
  /** Where each particle is heading. The morph controller writes here. */
  targets: Float32Array;
  /** Where each particle started (for tween interpolation). */
  origins: Float32Array;
  /** Per-particle target color. */
  colorTargets: Float32Array;
  /** Per-particle current color (mutated each frame toward target). */
  colors: Float32Array;
  /** Per-particle phase offset for idle drift. */
  phases: Float32Array;
  setSize(size: number): void;
  /** Push the latest `positions` / `colors` to the GPU. */
  flush(): void;
  dispose(): void;
}

export interface ParticleSystemOptions {
  count: number;
  /** Base sprite size (gl_PointSize). Auto-scales with pixel ratio + depth. */
  size?: number;
  /** Spawn radius for initial random positions. */
  spawnRadius?: number;
}

const VERT = /* glsl */ `
  attribute vec3 aColor;
  uniform float uSize;
  uniform float uPixelRatio;
  varying vec3 vColor;

  void main() {
    vColor = aColor;
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    // Standard size-attenuation: closer particles are bigger.
    gl_PointSize = uSize * uPixelRatio * (300.0 / max(-mv.z, 1.0));
    gl_Position = projectionMatrix * mv;
  }
`;

const FRAG = /* glsl */ `
  varying vec3 vColor;

  void main() {
    vec2 c = gl_PointCoord - vec2(0.5);
    float d = length(c);
    // Soft circular falloff with a hot core for that "spark" look.
    float core = smoothstep(0.5, 0.0, d);
    float halo = smoothstep(0.5, 0.15, d);
    float a = core * 0.55 + halo * 0.45;
    if (a < 0.01) discard;
    gl_FragColor = vec4(vColor, a);
  }
`;

export function createParticleSystem(opts: ParticleSystemOptions): ParticleSystem {
  const { count, size = 14, spawnRadius = 4 } = opts;

  const positions = new Float32Array(count * 3);
  const targets = new Float32Array(count * 3);
  const origins = new Float32Array(count * 3);
  const colors = new Float32Array(count * 3);
  const colorTargets = new Float32Array(count * 3);
  const phases = new Float32Array(count);

  for (let i = 0; i < count; i++) {
    const i3 = i * 3;
    // Random spherical-ish spawn so the first morph plays as "particles
    // rushing in from the void."
    const r = spawnRadius * (0.6 + Math.random() * 0.6);
    const theta = Math.random() * Math.PI * 2;
    const phi = Math.acos(2 * Math.random() - 1);
    positions[i3] = r * Math.sin(phi) * Math.cos(theta);
    positions[i3 + 1] = r * Math.sin(phi) * Math.sin(theta);
    positions[i3 + 2] = r * Math.cos(phi) * 0.4; // shallow Z so the camera doesn't miss them

    targets[i3] = positions[i3];
    targets[i3 + 1] = positions[i3 + 1];
    targets[i3 + 2] = positions[i3 + 2];
    origins[i3] = positions[i3];
    origins[i3 + 1] = positions[i3 + 1];
    origins[i3 + 2] = positions[i3 + 2];

    colors[i3] = 1;
    colors[i3 + 1] = 1;
    colors[i3 + 2] = 1;
    colorTargets[i3] = 1;
    colorTargets[i3 + 1] = 1;
    colorTargets[i3 + 2] = 1;

    phases[i] = Math.random() * Math.PI * 2;
  }

  const geometry = new THREE.BufferGeometry();
  const positionAttr = new THREE.BufferAttribute(positions, 3);
  positionAttr.setUsage(THREE.DynamicDrawUsage);
  const colorAttr = new THREE.BufferAttribute(colors, 3);
  colorAttr.setUsage(THREE.DynamicDrawUsage);
  geometry.setAttribute("position", positionAttr);
  geometry.setAttribute("aColor", colorAttr);

  const material = new THREE.ShaderMaterial({
    uniforms: {
      uSize: { value: size },
      uPixelRatio: {
        value: typeof window !== "undefined"
          ? Math.min(window.devicePixelRatio, 2)
          : 1,
      },
    },
    vertexShader: VERT,
    fragmentShader: FRAG,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  });

  const points = new THREE.Points(geometry, material);
  points.frustumCulled = false; // particles can swing wide during morph

  return {
    points,
    count,
    positions,
    targets,
    origins,
    colors,
    colorTargets,
    phases,
    setSize(next: number) {
      material.uniforms.uSize.value = next;
    },
    flush() {
      positionAttr.needsUpdate = true;
      colorAttr.needsUpdate = true;
    },
    dispose() {
      geometry.dispose();
      material.dispose();
    },
  };
}
