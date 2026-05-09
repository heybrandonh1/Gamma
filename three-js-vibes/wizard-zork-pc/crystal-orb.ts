import * as THREE from "three";

/**
 * A transmissive crystal orb on a small obsidian disc.
 *
 * Geometry: an `OctahedronGeometry` subdivided four times — the
 * smoothed-but-faceted look reads as a hand-cut crystal rather than a
 * perfect glass marble. Same technique as the threejs.org
 * `webgl_materials_physical_transmission` example.
 *
 * Material: `MeshPhysicalMaterial` with `transmission: 1`,
 * `thickness`, `roughness: 0.05`, `ior: 1.45` and a faint purple
 * `attenuationColor` so the inside has the slight tint of stained
 * glass without going full lava-lamp.
 *
 * Animation: slow rotation around Y, a tiny float bob in Y. Both
 * stop under `reduceMotion`.
 */

export interface CrystalOrb {
  readonly object: THREE.Group;
  setReducedMotion(reduced: boolean): void;
  tick(deltaSeconds: number): void;
  dispose(): void;
}

export interface CrystalOrbOptions {
  /** World position of the orb's centre. */
  position: THREE.Vector3;
  /** Outer radius of the crystal. */
  radius?: number;
}

export function createCrystalOrb(opts: CrystalOrbOptions): CrystalOrb {
  const { position, radius = 0.32 } = opts;

  const group = new THREE.Group();
  group.name = "crystal-orb";
  group.position.copy(position);

  // Obsidian base disc.
  const baseGeo = new THREE.CylinderGeometry(radius * 1.1, radius * 1.2, 0.05, 24);
  const baseMat = new THREE.MeshStandardMaterial({
    color: new THREE.Color("#0a0508"),
    roughness: 0.25,
    metalness: 0.4,
  });
  const base = new THREE.Mesh(baseGeo, baseMat);
  base.position.y = -radius - 0.02;
  group.add(base);

  // Crystal — subdivided octahedron, transmissive PBR.
  const crystalGeo = new THREE.OctahedronGeometry(radius, 4);
  const crystalMat = new THREE.MeshPhysicalMaterial({
    color: new THREE.Color("#e0d4ff"),
    metalness: 0.0,
    roughness: 0.05,
    transmission: 1,
    thickness: 0.6,
    ior: 1.45,
    attenuationColor: new THREE.Color("#a07cff"),
    attenuationDistance: 1.6,
    clearcoat: 0.6,
    clearcoatRoughness: 0.1,
  });
  const crystal = new THREE.Mesh(crystalGeo, crystalMat);
  group.add(crystal);

  // A subtle violet point light embedded in the crystal so it
  // self-illuminates a touch — sells the "magical" read without
  // overpowering the candles.
  const innerLight = new THREE.PointLight(0xb088ff, 0.7, 2.0, 1.6);
  innerLight.position.set(0, 0, 0);
  group.add(innerLight);

  let reduced = false;
  const baseY = position.y;
  let phase = 0;

  return {
    object: group,
    setReducedMotion(v: boolean) {
      reduced = v;
      if (reduced) {
        crystal.rotation.set(0, 0, 0);
        group.position.y = baseY;
      }
    },
    tick(delta: number) {
      if (reduced) return;
      phase += delta;
      crystal.rotation.y += delta * 0.5;
      crystal.rotation.x = Math.sin(phase * 0.4) * 0.15;
      group.position.y = baseY + Math.sin(phase * 0.8) * 0.03;
      innerLight.intensity = 0.55 + 0.25 * (0.5 + 0.5 * Math.sin(phase * 1.7));
    },
    dispose() {
      baseGeo.dispose();
      baseMat.dispose();
      crystalGeo.dispose();
      crystalMat.dispose();
    },
  };
}
