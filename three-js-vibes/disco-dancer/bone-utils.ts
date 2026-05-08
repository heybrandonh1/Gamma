import * as THREE from "three";

/**
 * Find the first bone whose name matches the given regex during a depth-first
 * traversal. Mixamo names wrists `mixamorigRightHand` / `mixamorigLeftHand`
 * (fingers are `mixamorig...HandIndex1` etc), and the head bone is
 * `mixamorigHead`, so anchored regexes like `/RightHand$/` or `/Head$/i` match
 * cleanly.
 */
export function findBone(
  root: THREE.Object3D,
  pattern: RegExp,
): THREE.Object3D | null {
  let match: THREE.Object3D | null = null;
  root.traverse((child) => {
    if (match) return;
    if (pattern.test(child.name)) match = child;
  });
  return match;
}

/**
 * Dispose every geometry / material / texture under `root` so we don't leak
 * GPU memory when the React component unmounts and the FBX is replaced.
 */
export function disposeObject(root: THREE.Object3D): void {
  root.traverse((child) => {
    if ((child as THREE.SkinnedMesh).isSkinnedMesh) {
      (child as THREE.SkinnedMesh).skeleton.dispose();
    }
    if ((child as THREE.Mesh).isMesh) {
      const mesh = child as THREE.Mesh;
      mesh.geometry?.dispose();
      const mats = Array.isArray(mesh.material)
        ? mesh.material
        : [mesh.material];
      for (const m of mats) {
        if (!m) continue;
        const mat = m as THREE.Material & { map?: THREE.Texture | null };
        mat.map?.dispose();
        mat.dispose();
      }
    }
  });
}
