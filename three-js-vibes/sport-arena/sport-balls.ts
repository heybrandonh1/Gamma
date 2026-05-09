import * as THREE from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";

/**
 * Sport-ball mesh builders for the SSGI Sport Arena vibe.
 *
 * Constraint: every sport ball type ends up rendered as a SINGLE
 * `InstancedMesh` so we can have ~100+ balls colliding in real time without
 * blowing the draw-call budget. That means each builder must emit:
 *
 *   1. A single merged `BufferGeometry` (sphere/body + decorative tubes
 *      baked in) with `geometry.groups` set up so we can pass a material
 *      *array* to `InstancedMesh`. Three's `InstancedMesh` happily honors
 *      multi-material geometries — it just issues one instanced draw call
 *      per group.
 *   2. A material array (or single material) that lines up with those
 *      groups. We use `MeshPhysicalMaterial` because the host scene runs
 *      WebGPU SSGI; physical materials are what make the indirect lighting
 *      actually pop.
 *   3. A "physics shape" descriptor — sphere radius for round balls, plus a
 *     cylinder spec for the hockey puck. The host wires these into Bounce
 *     dynamic bodies.
 *
 * No textures, no external assets — all surface detail (baseball stitches,
 * basketball seams, soccer-ball panels, football laces, puck rim band) is
 * procedural geometry merged into the base shape.
 */

export type SportBallType =
  | "baseball"
  | "basketball"
  | "soccer"
  | "football"
  | "hockey-puck";

/**
 * The collision shape Bounce should build for this ball type. Spheres cover
 * the round balls (and a "close enough" sphere for the football); the puck
 * uses a true cylinder so it lies flat and slides on its faces.
 */
export type BallPhysicsShape =
  | { kind: "sphere"; radius: number }
  | { kind: "cylinder"; radius: number; height: number };

export interface SportBallSpec {
  type: SportBallType;
  /** Single merged geometry — ready for `InstancedMesh`. */
  geometry: THREE.BufferGeometry;
  /**
   * Material array aligned with the merged geometry's groups. A length-1
   * array is fine — `InstancedMesh` treats it the same as a bare material.
   */
  materials: THREE.MeshPhysicalMaterial[];
  /** Bounce collision shape descriptor. */
  physics: BallPhysicsShape;
  /**
   * Friendly name for hover tooltips / debug overlays. Not currently used by
   * the renderer but cheap to expose.
   */
  label: string;
}

const COMMON_PHYSICAL = {
  // SSGI eats up clear-coat and roughness variation — these defaults read
  // well in the WebGPU pipeline without going overboard on glossiness.
  envMapIntensity: 1.0,
  reflectivity: 0.4,
};

// ---------- baseball --------------------------------------------------------

/**
 * Cream sphere + figure-8 red stitch curve (parametric great-circle with
 * latitude oscillating as a sine of double-longitude — same trick used in
 * the existing `sport-ball-morpher` baseball, just baked into a single merged
 * geometry so we can instance it).
 */
export function buildBaseballSpec(): SportBallSpec {
  const radius = 0.36;
  const sphereGeo = new THREE.SphereGeometry(radius, 32, 24);

  const seamPoints: THREE.Vector3[] = [];
  const SEG = 192;
  const SEAM_AMP = 0.62;
  for (let i = 0; i < SEG; i++) {
    const t = (i / SEG) * Math.PI * 2;
    const phi = Math.cos(2 * t) * SEAM_AMP;
    const theta = t;
    const r = radius * 1.005;
    seamPoints.push(
      new THREE.Vector3(
        r * Math.cos(phi) * Math.cos(theta),
        r * Math.sin(phi),
        r * Math.cos(phi) * Math.sin(theta),
      ),
    );
  }
  const seamCurve = new THREE.CatmullRomCurve3(seamPoints, true);
  const seamGeo = new THREE.TubeGeometry(seamCurve, 256, 0.012, 6, true);

  const merged = mergeGeometries([sphereGeo, seamGeo], true);
  if (!merged) throw new Error("baseball mergeGeometries failed");
  sphereGeo.dispose();
  seamGeo.dispose();

  const sphereMat = new THREE.MeshPhysicalMaterial({
    color: 0xfff4dc,
    roughness: 0.55,
    metalness: 0.0,
    ...COMMON_PHYSICAL,
  });
  const seamMat = new THREE.MeshPhysicalMaterial({
    color: 0xc8302b,
    roughness: 0.45,
    metalness: 0.0,
    ...COMMON_PHYSICAL,
  });

  return {
    type: "baseball",
    geometry: merged,
    materials: [sphereMat, seamMat],
    physics: { kind: "sphere", radius },
    label: "Baseball",
  };
}

// ---------- basketball ------------------------------------------------------

/**
 * Orange sphere + four dark seam tubes (one equator, one perpendicular great
 * circle, two ±45° around vertical) baked into the same geometry. The seams
 * sit just above the surface (`radius * 1.005`) to avoid z-fighting.
 */
export function buildBasketballSpec(): SportBallSpec {
  const radius = 0.48;
  const sphereGeo = new THREE.SphereGeometry(radius, 32, 24);

  const seamGeos: THREE.BufferGeometry[] = [];
  const greatCircle = (normal: THREE.Vector3): THREE.BufferGeometry => {
    const n = normal.clone().normalize();
    const ref =
      Math.abs(n.x) < 0.9
        ? new THREE.Vector3(1, 0, 0)
        : new THREE.Vector3(0, 1, 0);
    const u = new THREE.Vector3().crossVectors(n, ref).normalize();
    const v = new THREE.Vector3().crossVectors(n, u).normalize();
    const pts: THREE.Vector3[] = [];
    const r = radius * 1.005;
    const SEG = 128;
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
    return new THREE.TubeGeometry(curve, 192, 0.011, 6, true);
  };

  seamGeos.push(greatCircle(new THREE.Vector3(0, 1, 0)));
  seamGeos.push(greatCircle(new THREE.Vector3(1, 0, 0)));
  seamGeos.push(
    greatCircle(
      new THREE.Vector3(0, 0, 1).applyAxisAngle(
        new THREE.Vector3(0, 1, 0),
        Math.PI / 4,
      ),
    ),
  );
  seamGeos.push(
    greatCircle(
      new THREE.Vector3(0, 0, 1).applyAxisAngle(
        new THREE.Vector3(0, 1, 0),
        -Math.PI / 4,
      ),
    ),
  );
  // Merge all seam tubes into one sub-geometry first (single material group),
  // then merge that with the sphere to produce two groups total.
  const seamMerged = mergeGeometries(seamGeos);
  if (!seamMerged) throw new Error("basketball seam merge failed");
  seamGeos.forEach((g) => g.dispose());

  const merged = mergeGeometries([sphereGeo, seamMerged], true);
  if (!merged) throw new Error("basketball mergeGeometries failed");
  sphereGeo.dispose();
  seamMerged.dispose();

  const sphereMat = new THREE.MeshPhysicalMaterial({
    color: 0xff6f23,
    roughness: 0.78,
    metalness: 0.0,
    ...COMMON_PHYSICAL,
  });
  const seamMat = new THREE.MeshPhysicalMaterial({
    color: 0x2b1608,
    roughness: 0.6,
    metalness: 0.0,
    ...COMMON_PHYSICAL,
  });

  return {
    type: "basketball",
    geometry: merged,
    materials: [sphereMat, seamMat],
    physics: { kind: "sphere", radius },
    label: "Basketball",
  };
}

// ---------- soccer ball -----------------------------------------------------

/**
 * Real truncated icosahedron (12 pentagons + 20 hexagons), built by
 * truncating each icosahedron edge at the 1/3 and 2/3 points and projecting
 * the resulting 60 vertices onto a sphere. Pentagons map to material[0]
 * (black panels), hexagons to material[1] (white panels).
 *
 * Same construction as `sport-ball-morpher/mesh-builders.ts` — duplicated here so
 * this vibe stays self-contained and we can tweak the radius / shading
 * without affecting Sport Ball Morpher.
 */
function buildTruncatedIcosahedronGeometry(
  radius: number,
): THREE.BufferGeometry {
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

  const edgeKey = (a: number, b: number) =>
    a < b ? `${a}-${b}` : `${b}-${a}`;
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
    const ref =
      Math.abs(n.x) < 0.9
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
  geometry.setAttribute(
    "position",
    new THREE.Float32BufferAttribute(positions, 3),
  );
  geometry.setAttribute(
    "normal",
    new THREE.Float32BufferAttribute(normals, 3),
  );
  geometry.setIndex(indices);
  geometry.addGroup(0, pentTris * 3, 0);
  geometry.addGroup(pentTris * 3, hexTris * 3, 1);
  return geometry;
}

export function buildSoccerBallSpec(): SportBallSpec {
  const radius = 0.45;
  const geometry = buildTruncatedIcosahedronGeometry(radius);

  const blackPanel = new THREE.MeshPhysicalMaterial({
    color: 0x111111,
    roughness: 0.6,
    metalness: 0.0,
    ...COMMON_PHYSICAL,
  });
  const whitePanel = new THREE.MeshPhysicalMaterial({
    color: 0xf4f4f4,
    roughness: 0.55,
    metalness: 0.0,
    ...COMMON_PHYSICAL,
  });

  return {
    type: "soccer",
    geometry,
    materials: [blackPanel, whitePanel],
    physics: { kind: "sphere", radius },
    label: "Soccer Ball",
  };
}

// ---------- football --------------------------------------------------------

/**
 * Prolate spheroid (sphere stretched on z + tip-pinched) plus a white lace
 * strip along the top with cross-stitches. Geometry is merged so the entire
 * football lives in one buffer with two material groups (leather + laces).
 */
export function buildFootballSpec(): SportBallSpec {
  // Build prolate spheroid by deforming a sphere — same recipe as sport-ball-morpher
  // but with a smaller base radius so the long axis fits the box height.
  const baseRadius = 0.32;
  const ballGeo = new THREE.SphereGeometry(baseRadius, 32, 24);
  const pos = ballGeo.attributes.position;
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i);
    const y = pos.getY(i);
    const z = pos.getZ(i);
    const newZ = z * 1.7;
    const tipFactor = 1 - Math.pow(Math.abs(z) / baseRadius, 4) * 0.55;
    pos.setXYZ(i, x * tipFactor, y * tipFactor, newZ);
  }
  pos.needsUpdate = true;
  ballGeo.computeVertexNormals();

  // Laces strip — short tube along z near +y surface. Plus 7 cross stitches.
  const laceGeos: THREE.BufferGeometry[] = [];
  const stripPts: THREE.Vector3[] = [];
  for (let i = 0; i <= 24; i++) {
    const t = (i / 24) * 2 - 1;
    stripPts.push(
      new THREE.Vector3(0, baseRadius * 0.9 - 0.01 * t * t, t * 0.28),
    );
  }
  const stripCurve = new THREE.CatmullRomCurve3(stripPts);
  laceGeos.push(new THREE.TubeGeometry(stripCurve, 60, 0.008, 6, false));

  for (let i = 0; i < 7; i++) {
    const t = i / 6;
    const z = (t * 2 - 1) * 0.2;
    const stitchPts = [
      new THREE.Vector3(-0.04, baseRadius * 0.91 - 0.005 * (z * z), z),
      new THREE.Vector3(0.04, baseRadius * 0.91 - 0.005 * (z * z), z),
    ];
    const stitchCurve = new THREE.CatmullRomCurve3(stitchPts);
    laceGeos.push(new THREE.TubeGeometry(stitchCurve, 8, 0.009, 5, false));
  }
  const lacesMerged = mergeGeometries(laceGeos);
  if (!lacesMerged) throw new Error("football lace merge failed");
  laceGeos.forEach((g) => g.dispose());

  const merged = mergeGeometries([ballGeo, lacesMerged], true);
  if (!merged) throw new Error("football mergeGeometries failed");
  ballGeo.dispose();
  lacesMerged.dispose();

  const leatherMat = new THREE.MeshPhysicalMaterial({
    color: 0x6c3a1b,
    roughness: 0.7,
    metalness: 0.0,
    ...COMMON_PHYSICAL,
  });
  const laceMat = new THREE.MeshPhysicalMaterial({
    color: 0xf2efe4,
    roughness: 0.45,
    metalness: 0.0,
    ...COMMON_PHYSICAL,
  });

  return {
    type: "football",
    geometry: merged,
    // Use a sphere shape for collision (close enough — the footballs roll
    // and tumble convincingly without needing a true ellipsoid collider,
    // which Bounce doesn't ship out of the box).
    materials: [leatherMat, laceMat],
    physics: { kind: "sphere", radius: baseRadius * 1.1 },
    label: "Football",
  };
}

// ---------- hockey puck -----------------------------------------------------

/**
 * Short flat black cylinder + a slightly proud rim band sleeve. We render
 * with a true `CylinderGeometry` (oriented along +Y) and use a Bounce
 * `Cylinder` collider so the puck lies flat on its faces and slides
 * naturally. The geometry's local orientation matches the cylinder collider
 * (axis +Y), so reading body.orientation directly into the instance matrix
 * is correct — no extra basis rotation needed.
 */
export function buildHockeyPuckSpec(): SportBallSpec {
  const r = 0.36;
  const h = 0.18;

  const bodyGeo = new THREE.CylinderGeometry(r, r, h, 48);
  const bandGeo = new THREE.CylinderGeometry(
    r * 1.005,
    r * 1.005,
    h * 0.45,
    48,
    1,
    true,
  );

  const merged = mergeGeometries([bodyGeo, bandGeo], true);
  if (!merged) throw new Error("hockey puck mergeGeometries failed");
  bodyGeo.dispose();
  bandGeo.dispose();

  const bodyMat = new THREE.MeshPhysicalMaterial({
    color: 0x121212,
    roughness: 0.45,
    metalness: 0.15,
    ...COMMON_PHYSICAL,
  });
  const bandMat = new THREE.MeshPhysicalMaterial({
    color: 0x2a2a2a,
    roughness: 0.55,
    metalness: 0.05,
    ...COMMON_PHYSICAL,
  });

  return {
    type: "hockey-puck",
    geometry: merged,
    materials: [bodyMat, bandMat],
    physics: { kind: "cylinder", radius: r, height: h },
    label: "Hockey Puck",
  };
}

// ---------- registry --------------------------------------------------------

/**
 * Build all five sport-ball specs in one go. Ordered by approximate volume
 * (largest first) which the host uses to bias the spawn count — fewer
 * basketballs/soccer balls than baseballs/pucks so the box doesn't end up
 * feeling cramped with only large-radius bodies.
 */
export function buildAllSportBallSpecs(): SportBallSpec[] {
  return [
    buildBasketballSpec(),
    buildSoccerBallSpec(),
    buildFootballSpec(),
    buildBaseballSpec(),
    buildHockeyPuckSpec(),
  ];
}

/**
 * Tear down everything a `SportBallSpec` owns. The host calls this on
 * unmount; per-instance `InstancedMesh` disposal happens in the host.
 */
export function disposeSportBallSpec(spec: SportBallSpec) {
  spec.geometry.dispose();
  spec.materials.forEach((m) => m.dispose());
}
