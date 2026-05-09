import * as THREE from "three";

import {
  createJiggleUniforms,
  pokeJiggle,
  tickJiggle,
  type JiggleUniforms,
} from "./jiggle";
import {
  attachMorphAttributes,
  attachSportShader,
  createMorphUniforms,
  setMorphTarget,
  type MorphUniforms,
} from "./morph-shader";
import {
  makeCylinderDist,
  makeFootballDist,
  makeLatheDist,
  makeSphereDist,
  type SurfaceDistanceFn,
} from "./surface-distance";

/**
 * Procedural 3D meshes for the six sporting objects, built around a true
 * vertex-level silhouette morph.
 *
 * Each builder returns a {@link SportMesh} that exposes:
 *
 *   - `object`            — `Group` containing the body mesh plus any
 *                           decorative sub-meshes (stitches, seams, laces,
 *                           rim band).
 *   - `surfaceDist`       — ray-from-origin distance function for THIS sport's
 *                           silhouette. The show controller passes this into
 *                           the *other* mesh's `setMorphTarget` so the other
 *                           mesh's vertices know where to deform to.
 *   - `setMorphTarget`    — applies a target surface distance fn to every
 *                           morph-capable mesh in this group, recomputing
 *                           per-vertex `aTargetDist` attributes.
 *   - `setMorphProgress`  — drives the shared `uMorphT` uniform that drives
 *                           the silhouette interpolation in the vertex stage.
 *   - `setBodyOpacity`    — main body opacity. Outgoing body fades 1→0,
 *                           incoming body fades 0→1 simultaneously; because
 *                           both bodies share the same silhouette throughout
 *                           the morph (driven by the same pair of distance
 *                           fns), the crossfade reads as one shape molding
 *                           into the next, not two shapes overlapping.
 *   - `setDecorationOpacity` — opacity for decorations that don't morph
 *                           (currently just the baseball's instanced
 *                           stitches). Fades to zero at morph start, back
 *                           to one at morph end.
 *   - `spinAxis` / `spinSpeed` — auto-rotation per sport.
 *   - `poke` / `tickJiggle` — click-to-jello on top of the morphed shape.
 *   - `dispose`           — disposes every geometry / material.
 *
 * Surface details (baseball cross-stitches, basketball seams, football
 * laces, soccer-ball panel pattern, hockey-puck rim band) are still
 * procedural — no textures, no GLTF assets. Combined with the
 * `RoomEnvironment` PMREM-generated IBL the scene applies in
 * `sport-ball-morpher.tsx`, `MeshStandardMaterial` picks up real
 * reflections so the morphed silhouettes still read as physical objects.
 *
 * Orientation: every body mesh is built in its **normalized** orientation
 * (the orientation its `surfaceDist` is queried in). Aesthetic group
 * rotations the previous design applied (e.g. football tilt, hockey puck
 * lay-on-side) are baked into the geometry where they're functionally
 * required (puck axis along X) and dropped where they were purely cosmetic
 * (football tilt). `OrbitControls` covers the camera-angle aesthetics.
 */

export interface SportMesh {
  object: THREE.Group;
  /** Ray-from-origin surface distance fn for this sport's silhouette. */
  surfaceDist: SurfaceDistanceFn;
  /** Auto-rotation axis. */
  spinAxis: "x" | "y" | "z";
  /** Auto-rotation speed in rad/s. */
  spinSpeed: number;
  /**
   * Set this mesh's morph target so all of its morph-capable geometries
   * deform toward `surfaceDistance` instead of their rest silhouette
   * (when `setMorphProgress(1)` is called).
   */
  setMorphTarget(surfaceDistance: SurfaceDistanceFn): void;
  /** Drive the silhouette interpolation in [0, 1]. */
  setMorphProgress(t: number): void;
  /** Body opacity (the silhouette-morphing meshes). */
  setBodyOpacity(value: number): void;
  /** Non-morphing decoration opacity (currently just baseball stitches). */
  setDecorationOpacity(value: number): void;
  poke(localPoint: THREE.Vector3, amp?: number): void;
  tickJiggle(deltaSeconds: number): void;
  dispose(): void;
}

// ---------- helpers ---------------------------------------------------------

/**
 * Track a `Mesh` (or `InstancedMesh`) as participating in a particular
 * opacity bucket. The controller drives bodies and decorations on
 * different curves so we tag every sub-mesh up front instead of guessing
 * later from material flags.
 */
type OpacityBucket = "body" | "decoration";

interface SportMaterialEntry {
  material: THREE.MeshStandardMaterial;
  bucket: OpacityBucket;
}

interface SportBuilderState {
  group: THREE.Group;
  jiggle: JiggleUniforms;
  morph: MorphUniforms;
  /**
   * Geometries that should radially morph toward the next sport's
   * silhouette during a morph cycle. Their `aTargetDist` buffer is
   * recomputed every time `setMorphTarget` runs.
   */
  morphGeometries: THREE.BufferGeometry[];
  materials: SportMaterialEntry[];
  /** Auxiliary textures owned by this mesh (for `dispose`). */
  textures: THREE.Texture[];
}

function createState(): SportBuilderState {
  return {
    group: new THREE.Group(),
    jiggle: createJiggleUniforms(),
    morph: createMorphUniforms(),
    morphGeometries: [],
    materials: [],
    textures: [],
  };
}

/**
 * Build a transparent `MeshStandardMaterial` and wire it up to the sport's
 * shared morph + jiggle uniforms via {@link attachSportShader}. The
 * material starts at zero opacity because the show controller fades the
 * starting frame in once the cycle begins.
 */
function makeBodyMaterial(
  state: SportBuilderState,
  color: number,
  opts: {
    roughness?: number;
    metalness?: number;
    flat?: boolean;
    envMapIntensity?: number;
    bumpMap?: THREE.Texture;
    bumpScale?: number;
  } = {},
): THREE.MeshStandardMaterial {
  const material = new THREE.MeshStandardMaterial({
    color,
    roughness: opts.roughness ?? 0.5,
    metalness: opts.metalness ?? 0.05,
    flatShading: opts.flat ?? false,
    bumpMap: opts.bumpMap,
    bumpScale: opts.bumpScale,
    envMapIntensity: opts.envMapIntensity ?? 1.0,
    // Bodies stay transparent + non-depth-writing for the whole vibe's
    // life, not just during morphs. During a morph, two body meshes
    // overlap exactly with matched silhouettes and the outgoing layer
    // sits underneath the incoming with `α = 1`; if the outgoing wrote
    // depth here, the incoming layer would fail the default LESS depth
    // test at the same Z and never render. Always-transparent +
    // never-write-depth lets the show controller force render order
    // (`group.renderOrder`) instead, which is the only thing that needs
    // to change per morph.
    transparent: true,
    opacity: 0,
    depthWrite: false,
  });
  attachSportShader(material, state.morph, state.jiggle);
  state.materials.push({ material, bucket: "body" });
  return material;
}

/**
 * Same as {@link makeBodyMaterial} but without the morph attributes — used
 * for decorations like the baseball's instanced stitches that don't morph.
 * They get jiggle (so a click-to-jello on the body still wobbles the
 * stitches in lockstep) but they don't read `aDirection / aRestDist /
 * aTargetDist`. Their opacity tracks the decoration bucket so the show
 * controller can fade them out at the morph boundaries.
 */
function makeDecorationMaterial(
  state: SportBuilderState,
  color: number,
  opts: { roughness?: number; metalness?: number; envMapIntensity?: number } = {},
): THREE.MeshStandardMaterial {
  const material = new THREE.MeshStandardMaterial({
    color,
    roughness: opts.roughness ?? 0.55,
    metalness: opts.metalness ?? 0.05,
    envMapIntensity: opts.envMapIntensity ?? 0.7,
    transparent: true,
    opacity: 0,
    depthWrite: false,
  });
  state.materials.push({ material, bucket: "decoration" });
  return material;
}

/**
 * Register a body geometry as participating in the silhouette morph. Adds
 * `aDirection`/`aRestDist`/`aTargetDist` attributes and stores it on the
 * state so `setMorphTarget` can update its target distances per cycle.
 */
function registerMorphGeometry(
  state: SportBuilderState,
  geometry: THREE.BufferGeometry,
): void {
  attachMorphAttributes(geometry);
  state.morphGeometries.push(geometry);
}

function setOpacityForBucket(
  state: SportBuilderState,
  bucket: OpacityBucket,
  value: number,
): void {
  for (const entry of state.materials) {
    if (entry.bucket !== bucket) continue;
    entry.material.opacity = value;
  }
}

function disposeRecursive(obj: THREE.Object3D): void {
  obj.traverse((child) => {
    const mesh = child as THREE.Mesh;
    if (!mesh.isMesh) return;
    mesh.geometry?.dispose();
    const m = mesh.material;
    if (Array.isArray(m)) m.forEach((mat) => mat.dispose());
    else m?.dispose();
    if ((child as THREE.InstancedMesh).isInstancedMesh) {
      (child as THREE.InstancedMesh).dispose();
    }
  });
}

/**
 * Procedural "pebbled leather" bump map. Sprinkles small radial-gradient
 * bright dots over a mid-gray canvas so a basketball's surface picks up the
 * dimpled grain a hand-stippled normal map would otherwise need.
 */
function makePebbleBumpMap(size: number, density: number): THREE.CanvasTexture {
  const c = document.createElement("canvas");
  c.width = size;
  c.height = size;
  const ctx = c.getContext("2d")!;
  ctx.fillStyle = "#808080";
  ctx.fillRect(0, 0, size, size);
  const num = Math.floor(size * size * density);
  for (let i = 0; i < num; i++) {
    const x = Math.random() * size;
    const y = Math.random() * size;
    const r = 1 + Math.random() * 1.6;
    const a = 0.45 + Math.random() * 0.3;
    const grad = ctx.createRadialGradient(x, y, 0, x, y, r);
    grad.addColorStop(0, `rgba(255,255,255,${a})`);
    grad.addColorStop(1, "rgba(128,128,128,0)");
    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fill();
  }
  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(4, 2);
  tex.colorSpace = THREE.NoColorSpace;
  return tex;
}

function finalizeMesh(state: SportBuilderState, surfaceDist: SurfaceDistanceFn, opts: {
  spinAxis: "x" | "y" | "z";
  spinSpeed: number;
}): SportMesh {
  // Make sure no morph target survives between builds; the rest pose is
  // when target distance == rest distance, so we explicitly initialize that
  // even though attachMorphAttributes already wrote the right values.
  for (const geo of state.morphGeometries) setMorphTarget(geo, surfaceDist);

  return {
    object: state.group,
    surfaceDist,
    spinAxis: opts.spinAxis,
    spinSpeed: opts.spinSpeed,
    setMorphTarget(otherDist) {
      for (const geo of state.morphGeometries) setMorphTarget(geo, otherDist);
    },
    setMorphProgress(t) {
      state.morph.uMorphT.value = t;
    },
    setBodyOpacity(value) {
      setOpacityForBucket(state, "body", value);
    },
    setDecorationOpacity(value) {
      setOpacityForBucket(state, "decoration", value);
    },
    poke(p, a) {
      pokeJiggle(state.jiggle, p, a);
    },
    tickJiggle(d) {
      tickJiggle(state.jiggle, d);
    },
    dispose() {
      disposeRecursive(state.group);
      for (const tex of state.textures) tex.dispose();
    },
  };
}

// ---------- baseball --------------------------------------------------------

/**
 * Off-white cowhide sphere + 216 red angled cross-stitches placed along a
 * figure-8 seam curve via `InstancedMesh` (one capsule per stitch). The
 * sphere is a regular-mesh body and morphs along with the silhouette; the
 * stitches ride on `InstancedMesh` (one capsule geo replicated 216 times)
 * and so opt out of the per-vertex morph — instead they fade as decoration.
 */
export function buildBaseball(): SportMesh {
  const state = createState();
  const radius = 0.85;

  const sphereGeo = new THREE.SphereGeometry(radius, 128, 128);
  registerMorphGeometry(state, sphereGeo);
  const sphereMat = makeBodyMaterial(state, 0xfaf6ed, {
    roughness: 0.62,
    envMapIntensity: 0.85,
  });
  const sphereMesh = new THREE.Mesh(sphereGeo, sphereMat);
  // The morph re-projects vertices radially in the shader, which can
  // briefly grow the silhouette past the rest sphere's bounding sphere.
  // Disabling frustum culling keeps the morphed shape on screen even at
  // extreme target distances (e.g. baseball morphing toward a bat tip at
  // y ≈ 1.42).
  sphereMesh.frustumCulled = false;
  state.group.add(sphereMesh);

  const seamPoints: THREE.Vector3[] = [];
  const SEAM_AMP = 0.62;
  const SAMPLES = 240;
  for (let i = 0; i < SAMPLES; i++) {
    const t = (i / SAMPLES) * Math.PI * 2;
    const phi = Math.cos(2 * t) * SEAM_AMP;
    seamPoints.push(
      new THREE.Vector3(
        radius * Math.cos(phi) * Math.cos(t),
        radius * Math.sin(phi),
        radius * Math.cos(phi) * Math.sin(t),
      ),
    );
  }
  const seamCurve = new THREE.CatmullRomCurve3(seamPoints, true);

  const STITCH_COUNT = 216;
  const stitchGeo = new THREE.CapsuleGeometry(0.012, 0.075, 4, 8);
  const stitchMat = makeDecorationMaterial(state, 0xc62a25, {
    roughness: 0.55,
    envMapIntensity: 0.7,
  });
  const stitches = new THREE.InstancedMesh(stitchGeo, stitchMat, STITCH_COUNT);
  stitches.frustumCulled = false;

  const dummy = new THREE.Object3D();
  const tmpTan = new THREE.Vector3();
  const tmpNorm = new THREE.Vector3();
  const tmpBin = new THREE.Vector3();
  const tmpDir = new THREE.Vector3();
  const upY = new THREE.Vector3(0, 1, 0);
  const tmpQuat = new THREE.Quaternion();

  for (let i = 0; i < STITCH_COUNT; i++) {
    const t = i / STITCH_COUNT;
    const pos = seamCurve.getPointAt(t);
    seamCurve.getTangentAt(t, tmpTan).normalize();
    tmpNorm.copy(pos).normalize();
    tmpBin.crossVectors(tmpTan, tmpNorm).normalize();

    const tilt = i % 2 === 0 ? 0.55 : -0.55;
    tmpDir.copy(tmpBin).addScaledVector(tmpTan, tilt).normalize();

    dummy.position.copy(pos).addScaledVector(tmpNorm, 0.014);
    tmpQuat.setFromUnitVectors(upY, tmpDir);
    dummy.quaternion.copy(tmpQuat);
    dummy.scale.setScalar(1);
    dummy.updateMatrix();
    stitches.setMatrixAt(i, dummy.matrix);
  }
  stitches.instanceMatrix.needsUpdate = true;
  state.group.add(stitches);

  return finalizeMesh(state, makeSphereDist(radius), {
    spinAxis: "y",
    spinSpeed: 0.55,
  });
}

// ---------- bat -------------------------------------------------------------

const BAT_PROFILE: [number, number][] = [
  [0.0, -1.4],
  [0.18, -1.4],
  [0.18, -1.32],
  [0.10, -1.28],
  [0.10, -0.85],
  [0.13, -0.45],
  [0.20, 0.25],
  [0.25, 1.05],
  [0.22, 1.32],
  [0.0, 1.42],
];

/**
 * Lathe-revolved bat profile: knob at bottom → straight handle → taper out →
 * barrel → rounded tip. The 2D profile traces the silhouette of a real wood
 * bat. Long axis along Y in normalized orientation, which is also where the
 * bat's surface distance fn assumes it lives.
 */
export function buildBat(): SportMesh {
  const state = createState();
  const profile2D = BAT_PROFILE.map(([r, y]) => new THREE.Vector2(r, y));
  const geometry = new THREE.LatheGeometry(profile2D, 64);
  geometry.computeVertexNormals();
  registerMorphGeometry(state, geometry);

  const material = makeBodyMaterial(state, 0xc89668, {
    roughness: 0.55,
    envMapIntensity: 0.9,
  });
  const mesh = new THREE.Mesh(geometry, material);
  mesh.frustumCulled = false;
  state.group.add(mesh);

  return finalizeMesh(state, makeLatheDist(BAT_PROFILE), {
    spinAxis: "y",
    spinSpeed: 0.6,
  });
}

// ---------- basketball ------------------------------------------------------

/**
 * Pebbled-leather orange sphere + four dark seam tubes. The seams are
 * non-instanced `TubeGeometry` meshes, so they morph along with the body
 * silhouette — when the basketball is mid-morph toward a football, the
 * seam tubes deform smoothly into curves on the prolate-spheroid silhouette
 * rather than detaching or fading out.
 */
export function buildBasketball(): SportMesh {
  const state = createState();
  const radius = 0.95;

  const bumpMap = makePebbleBumpMap(512, 0.05);
  state.textures.push(bumpMap);

  const sphereGeo = new THREE.SphereGeometry(radius, 128, 128);
  registerMorphGeometry(state, sphereGeo);
  const sphereMat = makeBodyMaterial(state, 0xd35221, {
    roughness: 0.85,
    metalness: 0.04,
    envMapIntensity: 0.65,
    bumpMap,
    bumpScale: 0.009,
  });
  const sphereMesh = new THREE.Mesh(sphereGeo, sphereMat);
  sphereMesh.frustumCulled = false;
  state.group.add(sphereMesh);

  const seamMat = makeBodyMaterial(state, 0x1f0e07, {
    roughness: 0.7,
    envMapIntensity: 0.45,
  });

  const greatCircle = (normal: THREE.Vector3) => {
    const n = normal.clone().normalize();
    const ref = Math.abs(n.x) < 0.9
      ? new THREE.Vector3(1, 0, 0)
      : new THREE.Vector3(0, 1, 0);
    const u = new THREE.Vector3().crossVectors(n, ref).normalize();
    const v = new THREE.Vector3().crossVectors(n, u).normalize();
    const pts: THREE.Vector3[] = [];
    const r = radius * 1.004;
    const SEG = 192;
    for (let i = 0; i < SEG; i++) {
      const t = (i / SEG) * Math.PI * 2;
      pts.push(
        u
          .clone()
          .multiplyScalar(Math.cos(t) * r)
          .add(v.clone().multiplyScalar(Math.sin(t) * r)),
      );
    }
    const curve = new THREE.CatmullRomCurve3(pts, true);
    const geo = new THREE.TubeGeometry(curve, 256, 0.02, 10, true);
    registerMorphGeometry(state, geo);
    const mesh = new THREE.Mesh(geo, seamMat);
    mesh.frustumCulled = false;
    return mesh;
  };

  state.group.add(greatCircle(new THREE.Vector3(0, 1, 0)));
  state.group.add(greatCircle(new THREE.Vector3(1, 0, 0)));
  state.group.add(
    greatCircle(
      new THREE.Vector3(0, 0, 1).applyAxisAngle(
        new THREE.Vector3(0, 1, 0),
        Math.PI / 4,
      ),
    ),
  );
  state.group.add(
    greatCircle(
      new THREE.Vector3(0, 0, 1).applyAxisAngle(
        new THREE.Vector3(0, 1, 0),
        -Math.PI / 4,
      ),
    ),
  );

  return finalizeMesh(state, makeSphereDist(radius), {
    spinAxis: "y",
    spinSpeed: 0.7,
  });
}

// ---------- football --------------------------------------------------------

const FOOTBALL_BASE_R = 0.7;
const FOOTBALL_Z_STRETCH = 1.7;
const FOOTBALL_TIP_FALLOFF = 0.55;

/**
 * Football — sphere deformed into a prolate spheroid with quartic tip
 * tapers, plus a thin white lace strip and 7 cross stitches. Long axis
 * along Z in normalized orientation. The lace strip + cross stitches are
 * non-instanced `TubeGeometry` meshes and morph along with the body, so
 * even mid-morph the laces ride the deforming silhouette.
 *
 * Aesthetic group rotations the previous design used (`rotation.z = π/14`,
 * `rotation.x = -π/18`) are dropped — they shifted the football's frame
 * relative to the other sports and prevented a coherent silhouette morph.
 * `OrbitControls` is enough to angle the camera so the laces are visible.
 */
export function buildFootball(): SportMesh {
  const state = createState();

  const ARENA_BASE_R = 0.32;
  const SCALE = FOOTBALL_BASE_R / ARENA_BASE_R;

  const ballGeo = new THREE.SphereGeometry(FOOTBALL_BASE_R, 128, 128);
  const pos = ballGeo.attributes.position;
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i);
    const y = pos.getY(i);
    const z = pos.getZ(i);
    const newZ = z * FOOTBALL_Z_STRETCH;
    const tipFactor =
      1 - Math.pow(Math.abs(z) / FOOTBALL_BASE_R, 4) * FOOTBALL_TIP_FALLOFF;
    pos.setXYZ(i, x * tipFactor, y * tipFactor, newZ);
  }
  pos.needsUpdate = true;
  ballGeo.computeVertexNormals();
  registerMorphGeometry(state, ballGeo);

  const ballMat = makeBodyMaterial(state, 0x6c3a1b, {
    roughness: 0.7,
    metalness: 0,
    envMapIntensity: 1.0,
  });
  const ballMesh = new THREE.Mesh(ballGeo, ballMat);
  ballMesh.frustumCulled = false;
  state.group.add(ballMesh);

  const laceMat = makeBodyMaterial(state, 0xf2efe4, {
    roughness: 0.45,
    metalness: 0,
    envMapIntensity: 1.0,
  });

  const stripPts: THREE.Vector3[] = [];
  for (let i = 0; i <= 24; i++) {
    const t = (i / 24) * 2 - 1;
    stripPts.push(
      new THREE.Vector3(
        0,
        FOOTBALL_BASE_R * 0.9 - 0.01 * t * t * SCALE,
        t * 0.28 * SCALE,
      ),
    );
  }
  const stripCurve = new THREE.CatmullRomCurve3(stripPts);
  const stripGeo = new THREE.TubeGeometry(stripCurve, 60, 0.008 * SCALE, 6, false);
  registerMorphGeometry(state, stripGeo);
  const stripMesh = new THREE.Mesh(stripGeo, laceMat);
  stripMesh.frustumCulled = false;
  state.group.add(stripMesh);

  for (let i = 0; i < 7; i++) {
    const t = i / 6;
    const z = (t * 2 - 1) * 0.2 * SCALE;
    const stitchPts = [
      new THREE.Vector3(
        -0.04 * SCALE,
        FOOTBALL_BASE_R * 0.91 - 0.005 * (z * z),
        z,
      ),
      new THREE.Vector3(
        0.04 * SCALE,
        FOOTBALL_BASE_R * 0.91 - 0.005 * (z * z),
        z,
      ),
    ];
    const stitchCurve = new THREE.CatmullRomCurve3(stitchPts);
    const stitchGeo = new THREE.TubeGeometry(stitchCurve, 8, 0.009 * SCALE, 5, false);
    registerMorphGeometry(state, stitchGeo);
    const stitchMesh = new THREE.Mesh(stitchGeo, laceMat);
    stitchMesh.frustumCulled = false;
    state.group.add(stitchMesh);
  }

  return finalizeMesh(
    state,
    makeFootballDist(FOOTBALL_BASE_R, FOOTBALL_Z_STRETCH, FOOTBALL_TIP_FALLOFF),
    { spinAxis: "z", spinSpeed: 0.55 },
  );
}

// ---------- soccer ball -----------------------------------------------------

/**
 * Build a real truncated icosahedron (32 faces: 12 pentagons + 20 hexagons)
 * by truncating the 12 vertices of an icosahedron at 1/3 along each edge.
 * (Construction docs unchanged from the previous version — see git history.)
 */
function buildTruncatedIcosahedronGeometry(radius: number): THREE.BufferGeometry {
  const phi = (1 + Math.sqrt(5)) / 2;

  const icoVerts: [number, number, number][] = [
    [-1, phi, 0], [1, phi, 0], [-1, -phi, 0], [1, -phi, 0],
    [0, -1, phi], [0, 1, phi], [0, -1, -phi], [0, 1, -phi],
    [phi, 0, -1], [phi, 0, 1], [-phi, 0, -1], [-phi, 0, 1],
  ];
  const icoFaces: [number, number, number][] = [
    [0, 11, 5], [0, 5, 1], [0, 1, 7], [0, 7, 10], [0, 10, 11],
    [1, 5, 9], [5, 11, 4], [11, 10, 2], [10, 7, 6], [7, 1, 8],
    [3, 9, 4], [3, 4, 2], [3, 2, 6], [3, 6, 8], [3, 8, 9],
    [4, 9, 5], [2, 4, 11], [6, 2, 10], [8, 6, 7], [9, 8, 1],
  ];

  const edgeKey = (a: number, b: number) => (a < b ? `${a}-${b}` : `${b}-${a}`);
  const edges = new Set<string>();
  for (const [a, b, c] of icoFaces) {
    edges.add(edgeKey(a, b));
    edges.add(edgeKey(b, c));
    edges.add(edgeKey(c, a));
  }

  const truncPoints: [number, number, number][] = [];
  const lookup = new Map<string, number>();
  for (const key of edges) {
    const [a, b] = key.split("-").map(Number);
    const va = icoVerts[a];
    const vb = icoVerts[b];
    const pa: [number, number, number] = [
      va[0] + (vb[0] - va[0]) / 3,
      va[1] + (vb[1] - va[1]) / 3,
      va[2] + (vb[2] - va[2]) / 3,
    ];
    const pb: [number, number, number] = [
      va[0] + ((vb[0] - va[0]) * 2) / 3,
      va[1] + ((vb[1] - va[1]) * 2) / 3,
      va[2] + ((vb[2] - va[2]) * 2) / 3,
    ];
    const ia = truncPoints.push(pa) - 1;
    const ib = truncPoints.push(pb) - 1;
    lookup.set(`${key}:${a}`, ia);
    lookup.set(`${key}:${b}`, ib);
  }

  const neighbors: number[][] = Array.from({ length: 12 }, () => []);
  for (const key of edges) {
    const [a, b] = key.split("-").map(Number);
    neighbors[a].push(b);
    neighbors[b].push(a);
  }

  const orderedNeighbors: number[][] = neighbors.map((nbrs, vIdx) => {
    const v = new THREE.Vector3(...icoVerts[vIdx]);
    const n = v.clone().normalize();
    const ref = Math.abs(n.x) < 0.9
      ? new THREE.Vector3(1, 0, 0)
      : new THREE.Vector3(0, 1, 0);
    const u = new THREE.Vector3().crossVectors(n, ref).normalize();
    const w = new THREE.Vector3().crossVectors(n, u).normalize();
    return nbrs
      .map((nIdx) => {
        const nv = new THREE.Vector3(...icoVerts[nIdx]);
        const dir = nv.clone().sub(v);
        return { n: nIdx, angle: Math.atan2(dir.dot(w), dir.dot(u)) };
      })
      .sort((a, b) => a.angle - b.angle)
      .map((x) => x.n);
  });

  const pentagonFaces: number[][] = [];
  for (let v = 0; v < 12; v++) {
    const pent: number[] = [];
    for (const nb of orderedNeighbors[v]) {
      const pi = lookup.get(`${edgeKey(v, nb)}:${v}`);
      if (pi !== undefined) pent.push(pi);
    }
    if (pent.length === 5) pentagonFaces.push(pent);
  }

  const hexagonFaces: number[][] = [];
  for (const [a, b, c] of icoFaces) {
    const ab = edgeKey(a, b);
    const bc = edgeKey(b, c);
    const ca = edgeKey(c, a);
    hexagonFaces.push([
      lookup.get(`${ab}:${a}`)!,
      lookup.get(`${ab}:${b}`)!,
      lookup.get(`${bc}:${b}`)!,
      lookup.get(`${bc}:${c}`)!,
      lookup.get(`${ca}:${c}`)!,
      lookup.get(`${ca}:${a}`)!,
    ]);
  }

  const positions: number[] = [];
  const normals: number[] = [];
  for (const p of truncPoints) {
    const len = Math.hypot(p[0], p[1], p[2]);
    const x = (p[0] / len) * radius;
    const y = (p[1] / len) * radius;
    const z = (p[2] / len) * radius;
    positions.push(x, y, z);
    normals.push(x / radius, y / radius, z / radius);
  }

  const indices: number[] = [];
  let pentTris = 0;
  let hexTris = 0;
  for (const pent of pentagonFaces) {
    indices.push(pent[0], pent[1], pent[2]);
    indices.push(pent[0], pent[2], pent[3]);
    indices.push(pent[0], pent[3], pent[4]);
    pentTris += 3;
  }
  for (const hex of hexagonFaces) {
    indices.push(hex[0], hex[1], hex[2]);
    indices.push(hex[0], hex[2], hex[3]);
    indices.push(hex[0], hex[3], hex[4]);
    indices.push(hex[0], hex[4], hex[5]);
    hexTris += 4;
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute("normal", new THREE.Float32BufferAttribute(normals, 3));
  geometry.setIndex(indices);
  geometry.addGroup(0, pentTris * 3, 0);
  geometry.addGroup(pentTris * 3, hexTris * 3, 1);
  return geometry;
}

/**
 * Soccer ball — truncated icosahedron with a sphere silhouette so the
 * silhouette morph treats it like the baseball / basketball: vertices ride
 * the same `surfaceDist = radius` and morph radially toward the next
 * sport's silhouette. The two-material panel pattern (black pentagons,
 * white hexagons) rides along on the same morph attributes.
 */
export function buildSoccerBall(): SportMesh {
  const state = createState();
  const radius = 0.9;

  const panelGeo = buildTruncatedIcosahedronGeometry(radius);
  registerMorphGeometry(state, panelGeo);

  const blackPanelMat = makeBodyMaterial(state, 0x111111, {
    roughness: 0.6,
    metalness: 0,
    envMapIntensity: 1.0,
  });
  const whitePanelMat = makeBodyMaterial(state, 0xf4f4f4, {
    roughness: 0.55,
    metalness: 0,
    envMapIntensity: 1.0,
  });
  const panelMesh = new THREE.Mesh(panelGeo, [blackPanelMat, whitePanelMat]);
  panelMesh.frustumCulled = false;
  state.group.add(panelMesh);

  return finalizeMesh(state, makeSphereDist(radius), {
    spinAxis: "y",
    spinSpeed: 0.55,
  });
}

// ---------- hockey puck -----------------------------------------------------

/**
 * Short flat black cylinder + a thin secondary band ring around the rim.
 * The cylinder's natural axis (`CylinderGeometry`'s default Y axis) is
 * baked-rotated onto X so the puck's "lay on its side" pose is part of the
 * geometry rather than the group transform — the silhouette morph queries
 * surface distances in the same world frame the other sports use, so the
 * orientation must live with the geometry, not above it.
 */
export function buildHockeyPuck(): SportMesh {
  const state = createState();
  const r = 0.85;
  const h = 0.32;
  const HALF_HEIGHT = h / 2;

  // Bake `rotation.z = π/2` into the cylinder so its axis is along +X.
  // This is what `makeCylinderDist(..., "x")` assumes the puck looks like.
  const layOnSide = new THREE.Matrix4().makeRotationZ(Math.PI / 2);

  const bodyGeo = new THREE.CylinderGeometry(r, r, h, 96);
  bodyGeo.applyMatrix4(layOnSide);
  registerMorphGeometry(state, bodyGeo);
  const bodyMat = makeBodyMaterial(state, 0x121212, {
    roughness: 0.45,
    metalness: 0.15,
    envMapIntensity: 0.6,
  });
  const bodyMesh = new THREE.Mesh(bodyGeo, bodyMat);
  bodyMesh.frustumCulled = false;
  state.group.add(bodyMesh);

  const bandGeo = new THREE.CylinderGeometry(
    r * 1.005,
    r * 1.005,
    h * 0.45,
    96,
    1,
    true,
  );
  bandGeo.applyMatrix4(layOnSide);
  registerMorphGeometry(state, bandGeo);
  const bandMat = makeBodyMaterial(state, 0x2a2a2a, {
    roughness: 0.55,
    metalness: 0.05,
  });
  const bandMesh = new THREE.Mesh(bandGeo, bandMat);
  bandMesh.frustumCulled = false;
  state.group.add(bandMesh);

  return finalizeMesh(state, makeCylinderDist(r, HALF_HEIGHT, "x"), {
    // Spin around the cylinder's now-X axis so the puck spins on its rim.
    spinAxis: "x",
    spinSpeed: 0.8,
  });
}
