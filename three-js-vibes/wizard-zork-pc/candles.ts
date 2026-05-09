import * as THREE from "three";

/**
 * Two melted-wax candles + their flames + flickering point lights.
 *
 * Wax body: a {@link THREE.LatheGeometry} from a hand-edited profile
 * with a slight melt at the rim.
 *
 * Flame: a small additive cone whose Y-scale and intensity ride on a
 * deterministic 1D Perlin-like noise per candle so each one breathes
 * out of phase with the other.
 *
 * Point lights: warm orange, low range, intensity locked to the
 * matching flame's noise so the surrounding table top picks up the
 * flicker. `reduceMotion` pins both candles at `1.0` (no flicker, no
 * scale wobble).
 */

export interface Candles {
  readonly object: THREE.Group;
  setReducedMotion(reduced: boolean): void;
  tick(deltaSeconds: number): void;
  dispose(): void;
}

export interface CandlesOptions {
  /** World-space positions for the two candle bases. */
  positions: [THREE.Vector3, THREE.Vector3];
}

/**
 * Tiny pseudo-noise sampled with a 1D function. Combines three sine
 * waves at incommensurate frequencies — gives the lit-from-within
 * "alive" feel without a full noise lookup. Cheap, deterministic.
 */
function noise1d(x: number): number {
  return (
    Math.sin(x * 1.7) * 0.6 +
    Math.sin(x * 4.3 + 1.2) * 0.3 +
    Math.sin(x * 9.1 + 2.4) * 0.1
  );
}

function buildWaxProfile(): THREE.Vector2[] {
  const pts: THREE.Vector2[] = [];
  const radius = 0.12;
  const height = 0.7;
  // Bottom flat
  pts.push(new THREE.Vector2(0.0, 0));
  pts.push(new THREE.Vector2(radius, 0));
  // Slight inward pinch then back out for a hand-poured look.
  pts.push(new THREE.Vector2(radius * 0.97, height * 0.35));
  pts.push(new THREE.Vector2(radius * 1.02, height * 0.6));
  // Top rim with a small melt drip.
  pts.push(new THREE.Vector2(radius * 0.98, height * 0.92));
  pts.push(new THREE.Vector2(radius * 0.7, height * 0.96));
  pts.push(new THREE.Vector2(radius * 0.6, height * 0.99));
  pts.push(new THREE.Vector2(0.0, height));
  return pts;
}

export function createCandles(opts: CandlesOptions): Candles {
  const group = new THREE.Group();
  group.name = "candles";

  const profile = buildWaxProfile();
  const waxGeo = new THREE.LatheGeometry(profile, 28);
  const waxMat = new THREE.MeshStandardMaterial({
    color: new THREE.Color("#e9d6a8"),
    roughness: 0.55,
    metalness: 0.02,
    emissive: new THREE.Color("#3a1e0a"),
    emissiveIntensity: 0.15,
  });

  const flameGeo = new THREE.ConeGeometry(0.04, 0.13, 18, 1, true);
  const flames: THREE.Mesh[] = [];
  const lights: THREE.PointLight[] = [];
  const seeds: number[] = [];

  for (let i = 0; i < 2; i++) {
    const candle = new THREE.Group();
    candle.position.copy(opts.positions[i]);

    const wax = new THREE.Mesh(waxGeo, waxMat);
    candle.add(wax);

    // Wick — a tiny dark stub.
    const wickMat = new THREE.MeshStandardMaterial({
      color: new THREE.Color("#1a0c04"),
      roughness: 0.9,
    });
    const wickGeo = new THREE.CylinderGeometry(0.005, 0.005, 0.03, 6);
    const wick = new THREE.Mesh(wickGeo, wickMat);
    wick.position.y = 0.715;
    candle.add(wick);

    const flameMat = new THREE.MeshBasicMaterial({
      color: new THREE.Color("#ffb45e"),
      transparent: true,
      opacity: 0.88,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });
    const flame = new THREE.Mesh(flameGeo, flameMat);
    flame.position.y = 0.79;
    candle.add(flame);
    flames.push(flame);

    const light = new THREE.PointLight(0xffaa55, 1.3, 4.5, 1.4);
    light.position.y = 0.82;
    candle.add(light);
    lights.push(light);

    seeds.push(i * 17.3);
    group.add(candle);
  }

  let reduced = false;
  const t0 = performance.now() / 1000;

  return {
    object: group,
    setReducedMotion(v: boolean) {
      reduced = v;
      if (reduced) {
        for (const f of flames) f.scale.setScalar(1);
        for (const l of lights) l.intensity = 1.3;
      }
    },
    tick(_delta: number) {
      if (reduced) return;
      const t = performance.now() / 1000 - t0;
      for (let i = 0; i < flames.length; i++) {
        const n = noise1d(t * 4 + seeds[i]);
        const scale = 0.85 + 0.25 * (n * 0.5 + 0.5);
        flames[i].scale.set(0.9 + 0.15 * n, scale, 0.9 + 0.15 * n);
        lights[i].intensity = 1.05 + 0.55 * (n * 0.5 + 0.5);
      }
    },
    dispose() {
      waxGeo.dispose();
      waxMat.dispose();
      flameGeo.dispose();
      for (const f of flames) (f.material as THREE.Material).dispose();
    },
  };
}
