import * as THREE from "three";

/**
 * Two sprite-based particle clouds that drift over the table top:
 *
 *   * warm embers — curl up from the candles
 *   * teal magic dust — settles down from above the orb
 *
 * Both share a single procedurally-built radial-gradient sprite
 * (~64×64 canvas) and use `AdditiveBlending` so they read as light
 * rather than as solid material — same recipe as the threejs.org
 * `webgl_points_sprites` example.
 *
 * Per-particle state (initial position, drift velocity, sine wobble
 * phase) is precomputed into a {@link Float32Array} so the per-frame
 * cost is just one buffer write per system. A single shared time
 * uniform isn't enough because we want bounded vertical loops — once
 * a particle drifts past its ceiling/floor it wraps back to its
 * starting band.
 *
 * Frozen on `reduceMotion` (positions stay where they were last
 * advanced, no further motion).
 */

export interface MagicParticles {
  readonly object: THREE.Group;
  setReducedMotion(reduced: boolean): void;
  tick(deltaSeconds: number): void;
  dispose(): void;
}

interface SystemConfig {
  count: number;
  color: THREE.Color;
  size: number;
  /** Centre of the spawn volume. */
  origin: THREE.Vector3;
  /** Half-width of the spawn box in X/Z. */
  spread: number;
  /** Lower bound of the spawn band in Y. */
  yMin: number;
  /** Upper bound of the spawn band in Y. */
  yMax: number;
  /** Vertical drift sign — +1 rises, -1 falls. */
  driftSign: 1 | -1;
}

interface RuntimeSystem {
  readonly points: THREE.Points;
  readonly geometry: THREE.BufferGeometry;
  readonly material: THREE.PointsMaterial;
  readonly config: SystemConfig;
  /** Per-particle wobble phase / drift speed. */
  readonly phaseX: Float32Array;
  readonly phaseZ: Float32Array;
  readonly speed: Float32Array;
}

export interface MagicParticlesOptions {
  /** World-space centre of the warm-ember swarm (typically between the candles). */
  emberOrigin: THREE.Vector3;
  /** World-space centre of the cool-dust swarm (above the crystal orb). */
  dustOrigin: THREE.Vector3;
}

function buildSpriteTexture(): THREE.CanvasTexture {
  const size = 64;
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("magic-particles: 2D context unavailable");

  const grad = ctx.createRadialGradient(
    size / 2,
    size / 2,
    0,
    size / 2,
    size / 2,
    size / 2,
  );
  grad.addColorStop(0, "rgba(255, 255, 255, 1)");
  grad.addColorStop(0.4, "rgba(255, 255, 255, 0.55)");
  grad.addColorStop(1, "rgba(255, 255, 255, 0)");
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, size, size);

  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.needsUpdate = true;
  return tex;
}

function buildSystem(config: SystemConfig, sprite: THREE.Texture): RuntimeSystem {
  const { count, color, size, origin, spread, yMin, yMax } = config;

  const positions = new Float32Array(count * 3);
  const phaseX = new Float32Array(count);
  const phaseZ = new Float32Array(count);
  const speed = new Float32Array(count);

  for (let i = 0; i < count; i++) {
    positions[i * 3 + 0] = origin.x + (Math.random() - 0.5) * spread * 2;
    positions[i * 3 + 1] = origin.y + yMin + Math.random() * (yMax - yMin);
    positions[i * 3 + 2] = origin.z + (Math.random() - 0.5) * spread * 2;
    phaseX[i] = Math.random() * Math.PI * 2;
    phaseZ[i] = Math.random() * Math.PI * 2;
    speed[i] = 0.12 + Math.random() * 0.18;
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));

  const material = new THREE.PointsMaterial({
    color,
    size,
    map: sprite,
    blending: THREE.AdditiveBlending,
    transparent: true,
    depthWrite: false,
    sizeAttenuation: true,
  });

  const points = new THREE.Points(geometry, material);
  return { points, geometry, material, config, phaseX, phaseZ, speed };
}

export function createMagicParticles(opts: MagicParticlesOptions): MagicParticles {
  const sprite = buildSpriteTexture();
  const group = new THREE.Group();
  group.name = "magic-particles";

  const ember = buildSystem(
    {
      count: 70,
      color: new THREE.Color("#ffb45e"),
      size: 0.18,
      origin: opts.emberOrigin,
      spread: 1.6,
      yMin: 0.0,
      yMax: 1.6,
      driftSign: 1,
    },
    sprite,
  );
  group.add(ember.points);

  const dust = buildSystem(
    {
      count: 60,
      color: new THREE.Color("#9be9d6"),
      size: 0.12,
      origin: opts.dustOrigin,
      spread: 1.2,
      yMin: -0.5,
      yMax: 1.4,
      driftSign: -1,
    },
    sprite,
  );
  group.add(dust.points);

  let reduced = false;

  function advance(sys: RuntimeSystem, t: number, delta: number) {
    const pos = sys.geometry.attributes.position as THREE.BufferAttribute;
    const arr = pos.array as Float32Array;
    const { count, origin, yMin, yMax, driftSign, spread } = sys.config;
    for (let i = 0; i < count; i++) {
      const idx = i * 3;
      arr[idx + 0] =
        origin.x +
        Math.sin(t * 0.5 + sys.phaseX[i]) * spread * 0.4 +
        Math.cos(sys.phaseX[i] + t * 0.13) * spread * 0.6;
      arr[idx + 2] =
        origin.z +
        Math.cos(t * 0.4 + sys.phaseZ[i]) * spread * 0.4 +
        Math.sin(sys.phaseZ[i] + t * 0.11) * spread * 0.6;
      let y = arr[idx + 1] + driftSign * sys.speed[i] * delta;
      const ceil = origin.y + yMax;
      const floor = origin.y + yMin;
      if (driftSign > 0 && y > ceil) y = floor;
      if (driftSign < 0 && y < floor) y = ceil;
      arr[idx + 1] = y;
    }
    pos.needsUpdate = true;
  }

  let t = 0;

  return {
    object: group,
    setReducedMotion(v: boolean) {
      reduced = v;
    },
    tick(delta: number) {
      if (reduced) return;
      t += delta;
      advance(ember, t, delta);
      advance(dust, t, delta);
    },
    dispose() {
      ember.geometry.dispose();
      ember.material.dispose();
      dust.geometry.dispose();
      dust.material.dispose();
      sprite.dispose();
    },
  };
}
