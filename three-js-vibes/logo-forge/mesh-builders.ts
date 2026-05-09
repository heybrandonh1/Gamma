import * as THREE from "three";

/**
 * Procedural 3D meshes for the six sporting objects, built from three.js
 * primitive geometries with custom deformations. Every mesh starts with its
 * material at opacity 0 — the show-controller fades the active one in. The
 * `spinAxis` / `spinSpeed` describe how the controller should auto-rotate the
 * object while it's on stage.
 */

export interface SportMesh {
  mesh: THREE.Mesh;
  /** Axis the auto-rotation spins around while this mesh is the active one. */
  spinAxis: "x" | "y" | "z";
  /** Rotation speed in radians/sec. */
  spinSpeed: number;
  dispose(): void;
}

function makeMaterial(
  color: number,
  roughness = 0.5,
  metalness = 0.05,
  flat = false,
): THREE.MeshStandardMaterial {
  const mat = new THREE.MeshStandardMaterial({
    color,
    roughness,
    metalness,
    transparent: true,
    opacity: 0,
    flatShading: flat,
  });
  return mat;
}

/**
 * Cream-white sphere. Recognizable as a baseball from the color and the
 * smooth round form even without the iconic red stitch curves (which would
 * need a custom texture or a TubeGeometry pass — saved for v2).
 */
export function buildBaseball(): SportMesh {
  const geometry = new THREE.SphereGeometry(0.85, 64, 64);
  const material = makeMaterial(0xfff4dc, 0.5);
  const mesh = new THREE.Mesh(geometry, material);
  return {
    mesh,
    spinAxis: "y",
    spinSpeed: 0.55,
    dispose() {
      geometry.dispose();
      material.dispose();
    },
  };
}

/**
 * Lathe-revolved bat profile. The 2D profile (Vector2 array) traces the
 * silhouette from the bottom of the knob up through handle, taper, barrel,
 * and rounded tip; LatheGeometry sweeps it 360° around the y-axis.
 */
export function buildBat(): SportMesh {
  const profile: THREE.Vector2[] = [
    new THREE.Vector2(0.0, -1.4), // bottom-center seal
    new THREE.Vector2(0.18, -1.4), // outer edge of knob, base
    new THREE.Vector2(0.18, -1.32), // top of knob
    new THREE.Vector2(0.10, -1.28), // step into handle
    new THREE.Vector2(0.10, -0.85), // straight handle
    new THREE.Vector2(0.13, -0.45), // start of taper
    new THREE.Vector2(0.20, 0.25), // mid-barrel widening
    new THREE.Vector2(0.25, 1.05), // peak barrel
    new THREE.Vector2(0.22, 1.32), // shoulder before tip
    new THREE.Vector2(0.0, 1.42), // rounded tip seal
  ];
  const geometry = new THREE.LatheGeometry(profile, 48);
  geometry.computeVertexNormals();
  const material = makeMaterial(0xc89668, 0.55);
  const mesh = new THREE.Mesh(geometry, material);
  return {
    mesh,
    spinAxis: "y",
    spinSpeed: 0.6,
    dispose() {
      geometry.dispose();
      material.dispose();
    },
  };
}

/**
 * Slightly larger orange sphere — reads as a basketball from the color +
 * scale even without the seam pattern.
 */
export function buildBasketball(): SportMesh {
  const geometry = new THREE.SphereGeometry(0.95, 64, 64);
  const material = makeMaterial(0xff6f23, 0.7);
  const mesh = new THREE.Mesh(geometry, material);
  return {
    mesh,
    spinAxis: "y",
    spinSpeed: 0.7,
    dispose() {
      geometry.dispose();
      material.dispose();
    },
  };
}

/**
 * American football — start with a sphere, stretch along z and pinch the
 * ends with a quartic falloff so it has the iconic prolate-spheroid shape
 * with pointed tips.
 */
export function buildFootball(): SportMesh {
  const geometry = new THREE.SphereGeometry(0.7, 64, 64);
  const pos = geometry.attributes.position;
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i);
    const y = pos.getY(i);
    const z = pos.getZ(i);
    const newZ = z * 1.7;
    // Pinch the cross-section toward the tips: full radius at center,
    // shrunk near |z| → 1. Quartic falloff keeps the middle round and the
    // ends sharp.
    const tipFactor = 1 - Math.pow(Math.abs(z) / 0.7, 4) * 0.55;
    pos.setXYZ(i, x * tipFactor, y * tipFactor, newZ);
  }
  pos.needsUpdate = true;
  geometry.computeVertexNormals();
  const material = makeMaterial(0x6c3a1b, 0.65);
  const mesh = new THREE.Mesh(geometry, material);
  // Tilt slightly so the laces would face camera if we add them later.
  mesh.rotation.z = Math.PI / 12;
  return {
    mesh,
    spinAxis: "z",
    spinSpeed: 0.65,
    dispose() {
      geometry.dispose();
      material.dispose();
    },
  };
}

/**
 * Soccer ball — IcosahedronGeometry with detail=1 yields 80 triangular
 * faces that, when flat-shaded, read as a faceted soccer-ball-style sphere.
 * Not a true truncated icosahedron, but the silhouette + facets sell it.
 */
export function buildSoccerBall(): SportMesh {
  const geometry = new THREE.IcosahedronGeometry(0.9, 1);
  const material = makeMaterial(0xf2f2f2, 0.55, 0.05, /*flat*/ true);
  const mesh = new THREE.Mesh(geometry, material);
  return {
    mesh,
    spinAxis: "y",
    spinSpeed: 0.5,
    dispose() {
      geometry.dispose();
      material.dispose();
    },
  };
}

/**
 * Hockey puck — short black cylinder. Rotated so its flat faces point
 * along the world x-axis, giving a nice 3/4 view when the camera isn't
 * dead-on.
 */
export function buildHockeyPuck(): SportMesh {
  const geometry = new THREE.CylinderGeometry(0.85, 0.85, 0.32, 64);
  const material = makeMaterial(0x121212, 0.45, 0.15);
  const mesh = new THREE.Mesh(geometry, material);
  // Lay it flat (default cylinder axis is +Y; rotating about Z tips it onto
  // its side so the face is camera-readable).
  mesh.rotation.z = Math.PI / 2;
  // Then pitch it slightly so the rim is visible.
  mesh.rotation.x = Math.PI / 9;
  return {
    mesh,
    spinAxis: "x",
    spinSpeed: 0.85,
    dispose() {
      geometry.dispose();
      material.dispose();
    },
  };
}
