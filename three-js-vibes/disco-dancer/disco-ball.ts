import * as THREE from "three";

/**
 * A diamond-faceted mirror ball that descends from above the camera frame
 * and spins forever. The "real club disco ball" look is built from three
 * layers stacked at the same origin:
 *
 *   1. A high-detail `IcosahedronGeometry` (subdivision 3 → 320 triangles)
 *      rendered with `flatShading: true` so every triangle becomes its own
 *      mirror facet. The material is a `MeshPhysicalMaterial` at
 *      `metalness: 1, roughness: 0.02` with a thin-film `iridescence` layer
 *      so the facets pick up a rainbow shimmer at glancing angles, the way
 *      real mirrored balls glint under colored stage lights.
 *
 *   2. A halo of small additive `Points` orbiting the ball at slightly
 *      varying radii, with each point's brightness ping-ponging on its own
 *      phase. Reads as the "glittering sparkle" that flares off a real
 *      disco ball when the spotlights hit it.
 *
 *   3. A warm centerpiece `PointLight` so the ball still pulls focus
 *      against the light card background even when no club spot is on it.
 *
 * For the reflections themselves we generate a tiny PMREM env map from a
 * gradient room scene (cheap; runs once on construction). Without an env
 * map the mirror finish would render as a uniform near-black sphere.
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

/** Number of sparkle points orbiting the ball. */
const SPARKLE_COUNT = 96;
/** Sparkle orbit radius range, multiplied by RADIUS. */
const SPARKLE_R_MIN = 1.06;
const SPARKLE_R_MAX = 1.22;

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

  // The faceted ball itself. Subdivision 3 (320 triangles) gives the
  // dense "diamond mirror" look you see on real club balls without
  // tipping into shading-cost territory at this size on screen.
  // MeshPhysicalMaterial adds a thin-film iridescence layer on top of
  // the chrome base so each facet picks up a faint rainbow flare at
  // glancing angles when the spots sweep across — that's the "diamond
  // sparkle" tell.
  const ballGeo = new THREE.IcosahedronGeometry(RADIUS, 3);
  const ballMat = new THREE.MeshPhysicalMaterial({
    color: 0xeaeaea,
    metalness: 1,
    roughness: 0.02,
    flatShading: true,
    envMap: envTarget.texture,
    envMapIntensity: 2.2,
    emissive: 0x1f1f1f,
    emissiveIntensity: 0.35,
    clearcoat: 1,
    clearcoatRoughness: 0.0,
    iridescence: 0.7,
    iridescenceIOR: 1.35,
    iridescenceThicknessRange: [120, 520],
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

  // Sparkle halo: small additive points orbiting the ball at slightly
  // varied radii. Each point owns a phase and a frequency in the
  // attribute buffers below so update() can ping-pong opacity per-point
  // on the GPU side via vertex colors. We do the brightness modulation
  // in JS each frame (cheap — 96 multiplies) and feed it as the alpha
  // component of the color attribute.
  const sparkleGeo = new THREE.BufferGeometry();
  const sparklePositions = new Float32Array(SPARKLE_COUNT * 3);
  const sparkleColors = new Float32Array(SPARKLE_COUNT * 3);
  // Phase offsets and per-point sparkle frequencies, kept in JS land so
  // we can advance them without touching the GPU buffer.
  const sparklePhase = new Float32Array(SPARKLE_COUNT);
  const sparkleFreq = new Float32Array(SPARKLE_COUNT);

  for (let i = 0; i < SPARKLE_COUNT; i++) {
    // Even-ish distribution on a sphere via a fibonacci spiral — avoids
    // the visible clumping you get from naive uniform-random.
    const phi = Math.acos(1 - (2 * (i + 0.5)) / SPARKLE_COUNT);
    const theta = Math.PI * (1 + Math.sqrt(5)) * i;
    const r =
      RADIUS *
      (SPARKLE_R_MIN + Math.random() * (SPARKLE_R_MAX - SPARKLE_R_MIN));
    sparklePositions[i * 3 + 0] = r * Math.sin(phi) * Math.cos(theta);
    sparklePositions[i * 3 + 1] = r * Math.cos(phi);
    sparklePositions[i * 3 + 2] = r * Math.sin(phi) * Math.sin(theta);
    sparklePhase[i] = Math.random() * Math.PI * 2;
    sparkleFreq[i] = 1.6 + Math.random() * 2.4;
    // Slight cool/warm tint variation so the sparkles don't all read as
    // identical white pinpricks — picks white, warm-white, or cool-white
    // per point. Initial baseline is "dim" so the halo doesn't pop bright
    // for one frame before update() takes over.
    const tint = i % 3;
    const baseR = tint === 0 ? 1.0 : tint === 1 ? 1.0 : 0.82;
    const baseG = tint === 0 ? 1.0 : tint === 1 ? 0.95 : 0.92;
    const baseB = tint === 0 ? 1.0 : tint === 1 ? 0.78 : 1.0;
    sparkleColors[i * 3 + 0] = baseR * 0.15;
    sparkleColors[i * 3 + 1] = baseG * 0.15;
    sparkleColors[i * 3 + 2] = baseB * 0.15;
  }
  sparkleGeo.setAttribute(
    "position",
    new THREE.BufferAttribute(sparklePositions, 3),
  );
  sparkleGeo.setAttribute(
    "color",
    new THREE.BufferAttribute(sparkleColors, 3),
  );
  const sparkleMat = new THREE.PointsMaterial({
    size: 4.0,
    sizeAttenuation: true,
    vertexColors: true,
    transparent: true,
    opacity: 1.0,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
  });
  const sparkles = new THREE.Points(sparkleGeo, sparkleMat);
  group.add(sparkles);

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

  // Accumulated wall-clock seconds — we drive sparkle phases off this so
  // pausing (reduce-motion) freezes them mid-twinkle instead of jumping.
  let sparkleClock = 0;

  function update(dt: number, paused = false) {
    if (paused) return;
    ball.rotation.y += 0.4 * dt;
    cap.rotation.y = ball.rotation.y;

    // Counter-rotate the sparkle halo a touch so it doesn't drift in
    // perfect lockstep with the ball — sells the "scattered light"
    // effect rather than "decals on the surface".
    sparkles.rotation.y -= 0.18 * dt;

    sparkleClock += dt;
    const colorAttr = sparkleGeo.getAttribute("color") as THREE.BufferAttribute;
    for (let i = 0; i < SPARKLE_COUNT; i++) {
      // Per-sparkle brightness: mostly dim with periodic bright flashes.
      // Skewed toward 0 so most points sit dark and only a handful are
      // glinting at any given instant — that's what gives a real disco
      // ball that "scattering" feel rather than uniform glitter.
      const wave = Math.sin(sparkleClock * sparkleFreq[i] + sparklePhase[i]);
      const flash = Math.max(0, wave) ** 4; // sharp flashes, dim baseline
      const brightness = 0.15 + 0.85 * flash;
      const baseR = i % 3 === 0 ? 1.0 : i % 3 === 1 ? 1.0 : 0.82;
      const baseG = i % 3 === 0 ? 1.0 : i % 3 === 1 ? 0.95 : 0.92;
      const baseB = i % 3 === 0 ? 1.0 : i % 3 === 1 ? 0.78 : 1.0;
      colorAttr.array[i * 3 + 0] = baseR * brightness;
      colorAttr.array[i * 3 + 1] = baseG * brightness;
      colorAttr.array[i * 3 + 2] = baseB * brightness;
    }
    colorAttr.needsUpdate = true;
  }

  function dispose() {
    ballGeo.dispose();
    ballMat.dispose();
    capGeo.dispose();
    capMat.dispose();
    stringGeo.dispose();
    stringMat.dispose();
    sparkleGeo.dispose();
    sparkleMat.dispose();
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
