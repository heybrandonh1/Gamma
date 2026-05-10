import * as THREE from "three";

/**
 * A faceted chrome disco ball that descends from above the camera frame and
 * spins forever. The mirror-facet look comes from `IcosahedronGeometry` with
 * `flatShading: true` — every triangle becomes its own mirrored facet.
 *
 * For the reflections themselves we generate a tiny PMREM env map from a
 * gradient room scene (cheap; runs once on construction). Without an env map,
 * `metalness: 1, roughness: 0.05` would render as a uniform black sphere on
 * the light card background.
 *
 * Pattern adapted from three.js's PMREM examples
 * (https://threejs.org/examples/#webgl_materials_envmaps_hdr).
 */

// Just a touch lower than the previous 360 — the ball reads a bit closer
// to the dancer's silhouette without crowding the head.
const RESTING_Y = 320;
const HIDDEN_Y = 1100;
const RADIUS = 28;

export interface DiscoBall {
  group: THREE.Group;
  /**
   * Lerped height — pass `t` from 0 (hidden, well above the camera) to 1
   * (resting, just above the dancer's head). Show-controller is responsible
   * for tweening this over the descent duration.
   */
  setHeight: (t: number) => void;
  /** Per-frame spin and floor-spot animation. */
  update: (deltaSeconds: number, paused?: boolean) => void;
  dispose: () => void;
}

/**
 * Build a tiny gradient cube the PMREMGenerator can integrate over to give
 * the ball something interesting to reflect. We don't render this scene
 * directly — it just feeds the env map.
 */
function buildEnvScene(): THREE.Scene {
  const env = new THREE.Scene();
  // Six colored emissive faces of a 1x1x1 cube, BackSide so we're inside the
  // box. Colors mirror the floor / club-light palette so the ball reflects
  // those hues even before the spotlights kick on.
  const colors = [0xffd633, 0x33ff99, 0x9933ff, 0x33ccff, 0xff3366, 0xff9933];
  for (let i = 0; i < 6; i++) {
    const mat = new THREE.MeshBasicMaterial({
      color: colors[i],
      side: THREE.BackSide,
    });
    const face = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), mat);
    // Rotate each plane onto a face of the cube. The order doesn't really
    // matter — we just need a roughly omnidirectional source of color.
    if (i === 0) face.position.set(0, 0, -0.5);
    else if (i === 1) { face.position.set(0, 0, 0.5); face.rotation.y = Math.PI; }
    else if (i === 2) { face.position.set(-0.5, 0, 0); face.rotation.y = -Math.PI / 2; }
    else if (i === 3) { face.position.set(0.5, 0, 0); face.rotation.y = Math.PI / 2; }
    else if (i === 4) { face.position.set(0, 0.5, 0); face.rotation.x = Math.PI / 2; }
    else { face.position.set(0, -0.5, 0); face.rotation.x = -Math.PI / 2; }
    env.add(face);
  }
  return env;
}

export function buildDiscoBall(renderer: THREE.WebGLRenderer): DiscoBall {
  const group = new THREE.Group();
  group.name = "disco-dancer-disco-ball";
  group.position.y = HIDDEN_Y;

  // Generate the env map. PMREMGenerator handles the prefiltering; we keep
  // a reference so we can dispose it on cleanup.
  const pmrem = new THREE.PMREMGenerator(renderer);
  pmrem.compileEquirectangularShader();
  const envScene = buildEnvScene();
  const envTarget = pmrem.fromScene(envScene);

  // The faceted ball itself.
  const ballGeo = new THREE.IcosahedronGeometry(RADIUS, 2);
  const ballMat = new THREE.MeshStandardMaterial({
    color: 0xc8c8c8,
    metalness: 1,
    roughness: 0.08,
    flatShading: true,
    envMap: envTarget.texture,
    envMapIntensity: 1.4,
    emissive: 0x1a1a1a,
    emissiveIntensity: 0.3,
  });
  const ball = new THREE.Mesh(ballGeo, ballMat);
  ball.castShadow = true;
  ball.receiveShadow = false;
  group.add(ball);

  // Chrome cap on top + thin string up to the implicit ceiling.
  const capGeo = new THREE.CylinderGeometry(4, 4, 6, 16);
  const capMat = new THREE.MeshStandardMaterial({
    color: 0x888888, metalness: 1, roughness: 0.2, envMap: envTarget.texture,
  });
  const cap = new THREE.Mesh(capGeo, capMat);
  cap.position.y = RADIUS + 3;
  group.add(cap);

  const stringGeo = new THREE.CylinderGeometry(0.6, 0.6, 220, 8);
  const stringMat = new THREE.MeshBasicMaterial({ color: 0x444444 });
  const string = new THREE.Mesh(stringGeo, stringMat);
  string.position.y = RADIUS + 6 + 110;
  group.add(string);

  // Warm centerpiece light so the ball pulls focus.
  const halo = new THREE.PointLight(0xfff1c2, 0.9, 280, 2);
  halo.position.set(0, 0, 0);
  group.add(halo);

  function setHeight(t: number) {
    const clamped = Math.max(0, Math.min(1, t));
    // Smooth-step easing for a nicer "drop into place" feel.
    const eased = clamped * clamped * (3 - 2 * clamped);
    group.position.y = HIDDEN_Y + (RESTING_Y - HIDDEN_Y) * eased;
  }

  function update(dt: number, paused = false) {
    if (paused) return;
    ball.rotation.y += 0.4 * dt;
    cap.rotation.y = ball.rotation.y;
  }

  function dispose() {
    ballGeo.dispose();
    ballMat.dispose();
    capGeo.dispose();
    capMat.dispose();
    stringGeo.dispose();
    stringMat.dispose();
    envTarget.dispose();
    pmrem.dispose();
    // The env-scene Meshes hold their own throwaway geos+mats; release them.
    envScene.traverse((child) => {
      if ((child as THREE.Mesh).isMesh) {
        const mesh = child as THREE.Mesh;
        mesh.geometry.dispose();
        const m = mesh.material as THREE.Material;
        m.dispose();
      }
    });
  }

  return { group, setHeight, update, dispose };
}
