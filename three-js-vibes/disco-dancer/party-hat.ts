import * as THREE from "three";

/**
 * Rainbow jester crown: four colored cone "horns" arranged around a chunky
 * gold band, each topped with a small emissive pompom. Sized for a Mixamo
 * head bone (~25 units across).
 *
 * Returns one Group ready to be `head.add()`-ed and an explicit dispose() to
 * free GPU memory on unmount.
 */

const SPIKE_COLORS = [0xff2d75, 0xffd23f, 0x2dd4bf, 0x6366f1];

export function buildPartyHat(): {
  group: THREE.Group;
  dispose: () => void;
} {
  const group = new THREE.Group();
  group.name = "disco-dancer-jester-hat";

  // Chunky gold band — reads as the "crown" the spikes sprout from.
  const bandGeo = new THREE.TorusGeometry(11, 1.6, 14, 32);
  const bandMat = new THREE.MeshStandardMaterial({
    color: 0xffd166,
    metalness: 1,
    roughness: 0.18,
    emissive: 0x4a3000,
    emissiveIntensity: 0.25,
  });
  const band = new THREE.Mesh(bandGeo, bandMat);
  band.rotation.x = Math.PI / 2;
  band.position.y = 0.3;
  band.castShadow = true;
  group.add(band);

  // Track every disposable so the host can clean up on unmount without
  // having to re-walk the group.
  const geometries: THREE.BufferGeometry[] = [bandGeo];
  const materials: THREE.Material[] = [bandMat];

  for (let i = 0; i < SPIKE_COLORS.length; i++) {
    const theta = (i / SPIKE_COLORS.length) * Math.PI * 2;
    const color = SPIKE_COLORS[i];

    // Spike — slim cone, tilted slightly outward so the four tips fan out
    // like a jester's hat. Cones default to +Y up so the rotation rolls
    // them onto the band without extra math.
    const spikeGeo = new THREE.ConeGeometry(4.2, 18, 18);
    const spikeMat = new THREE.MeshStandardMaterial({
      color,
      emissive: color,
      emissiveIntensity: 0.4,
      metalness: 0.2,
      roughness: 0.45,
    });
    const spike = new THREE.Mesh(spikeGeo, spikeMat);
    spike.position.set(Math.cos(theta) * 6.5, 9, Math.sin(theta) * 6.5);
    // Lean each spike outward by ~0.25 rad along the radial axis. The two
    // tilt components below project the lean onto world X/Z given theta.
    spike.rotation.set(
      0.25 * Math.sin(theta),
      0,
      -0.25 * Math.cos(theta),
    );
    spike.castShadow = true;
    group.add(spike);
    geometries.push(spikeGeo);
    materials.push(spikeMat);

    // Pompom on tip — stronger emissive so it reads as a glowing bauble.
    const pomGeo = new THREE.SphereGeometry(2.4, 18, 14);
    const pomMat = new THREE.MeshStandardMaterial({
      color,
      emissive: color,
      emissiveIntensity: 1.0,
      metalness: 0.05,
      roughness: 0.4,
    });
    const pom = new THREE.Mesh(pomGeo, pomMat);
    pom.position.y = 11; // Local to the spike (cone +Y is the tip).
    pom.castShadow = true;
    spike.add(pom);
    geometries.push(pomGeo);
    materials.push(pomMat);
  }

  return {
    group,
    dispose: () => {
      for (const g of geometries) g.dispose();
      for (const m of materials) m.dispose();
    },
  };
}
