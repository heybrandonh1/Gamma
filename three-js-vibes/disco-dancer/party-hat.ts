import * as THREE from "three";

/**
 * Cone party hat with a torus brim and pompom on top, sized for a Mixamo
 * head bone (~25 units across). Returns a single Group that can be
 * `head.add()`-ed and an explicit dispose() to free GPU memory on unmount.
 *
 * Color params let the host theme it; defaults are a bright pastel pink that
 * pops against the muted disco floor without clashing with the gold key.
 */
export function buildPartyHat(opts?: {
  hatColor?: number;
  brimColor?: number;
  pompomColor?: number;
}): {
  group: THREE.Group;
  dispose: () => void;
} {
  const hatColor = opts?.hatColor ?? 0xff77a8;
  const brimColor = opts?.brimColor ?? 0xffffff;
  const pompomColor = opts?.pompomColor ?? 0xfff0a0;

  const hatMat = new THREE.MeshStandardMaterial({
    color: hatColor,
    metalness: 0.05,
    roughness: 0.55,
    emissive: hatColor,
    emissiveIntensity: 0.18,
  });
  const brimMat = new THREE.MeshStandardMaterial({
    color: brimColor,
    metalness: 0.1,
    roughness: 0.4,
  });
  const pompomMat = new THREE.MeshStandardMaterial({
    color: pompomColor,
    metalness: 0.05,
    roughness: 0.6,
    emissive: pompomColor,
    emissiveIntensity: 0.35,
  });

  const group = new THREE.Group();
  group.name = "disco-dancer-party-hat";

  // Cone — `radialSegments=24` keeps it smooth without overspending verts.
  const coneGeo = new THREE.ConeGeometry(11, 26, 24, 1, false);
  const cone = new THREE.Mesh(coneGeo, hatMat);
  cone.position.y = 13;
  cone.castShadow = true;

  // Brim ring around the bottom of the cone.
  const brimGeo = new THREE.TorusGeometry(11, 1.4, 12, 28);
  const brim = new THREE.Mesh(brimGeo, brimMat);
  brim.rotation.x = Math.PI / 2;
  brim.position.y = 0.2;
  brim.castShadow = true;

  // Pompom on the tip.
  const pompomGeo = new THREE.SphereGeometry(2.6, 18, 14);
  const pompom = new THREE.Mesh(pompomGeo, pompomMat);
  pompom.position.y = 27;
  pompom.castShadow = true;

  group.add(cone, brim, pompom);

  return {
    group,
    dispose: () => {
      coneGeo.dispose();
      brimGeo.dispose();
      pompomGeo.dispose();
      hatMat.dispose();
      brimMat.dispose();
      pompomMat.dispose();
    },
  };
}
