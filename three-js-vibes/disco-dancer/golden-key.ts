import * as THREE from "three";

/**
 * Chunky gold skeleton key. Geometry units roughly match the Samba Dancing
 * FBX (which is ~200 units tall at scale 1) so the key reads as hand-sized
 * once parented to a Mixamo wrist bone. Adapted from the Project Alpha
 * case-study-access dancer.
 */
export function buildGoldenKey(): {
  group: THREE.Group;
  dispose: () => void;
} {
  const goldMat = new THREE.MeshStandardMaterial({
    color: 0xffcf3a,
    metalness: 1,
    roughness: 0.22,
    emissive: 0xffa30a,
    emissiveIntensity: 0.45,
  });

  const group = new THREE.Group();
  group.name = "disco-dancer-key";

  const bowGeo = new THREE.TorusGeometry(4.5, 1.4, 18, 36);
  const bow = new THREE.Mesh(bowGeo, goldMat);
  bow.castShadow = true;

  const shaftGeo = new THREE.CylinderGeometry(0.9, 0.9, 18, 18);
  const shaft = new THREE.Mesh(shaftGeo, goldMat);
  shaft.position.y = -10;
  shaft.castShadow = true;

  const collarGeo = new THREE.CylinderGeometry(1.5, 1.5, 1.2, 18);
  const collar = new THREE.Mesh(collarGeo, goldMat);
  collar.position.y = -2.4;
  collar.castShadow = true;

  const bitGeo = new THREE.BoxGeometry(3.4, 2.6, 1.4);
  const bit = new THREE.Mesh(bitGeo, goldMat);
  bit.position.set(2.0, -17, 0);
  bit.castShadow = true;

  const toothGeo = new THREE.BoxGeometry(2.0, 1.6, 1.4);
  const tooth = new THREE.Mesh(toothGeo, goldMat);
  tooth.position.set(1.4, -14.5, 0);
  tooth.castShadow = true;

  // Tiny warm point light so the key reads as glowing metal even in shadow.
  const halo = new THREE.PointLight(0xffd066, 1.5, 35, 2);
  halo.position.set(0, -8, 0);

  group.add(bow, collar, shaft, bit, tooth, halo);

  return {
    group,
    dispose: () => {
      bowGeo.dispose();
      shaftGeo.dispose();
      collarGeo.dispose();
      bitGeo.dispose();
      toothGeo.dispose();
      goldMat.dispose();
    },
  };
}
