import * as THREE from "three";

/**
 * Procedural 3D meshes for the six sporting objects. Each builder returns a
 * `SportMesh` that exposes:
 *
 *   - `object`     — a `Group` (so we can layer e.g. a baseball with its
 *                    stitch tubes, or a soccer ball with multi-material faces)
 *   - `spinAxis`   — which axis the show-controller should auto-rotate on
 *   - `spinSpeed`  — radians/sec
 *   - `setOpacity` — traverses the group and sets opacity on every material
 *                    (handles arrays for multi-material meshes too)
 *   - `dispose`    — traverses and disposes every geometry/material
 *
 * Realism notes: surface detail (baseball stitches, basketball seams, football
 * laces, soccer-ball panels, hockey-puck rim band) is procedural — no textures,
 * no external assets. Combined with the `RoomEnvironment` PMREM-generated IBL
 * the scene applies in `sport-ball-morpher.tsx`, MeshStandardMaterial picks up real
 * reflections and these objects read as actual physical balls / equipment.
 */

export interface SportMesh {
  object: THREE.Object3D;
  spinAxis: "x" | "y" | "z";
  spinSpeed: number;
  setOpacity(value: number): void;
  dispose(): void;
}

// ---------- helpers ---------------------------------------------------------

function setOpacityRecursive(obj: THREE.Object3D, value: number) {
  obj.traverse((child) => {
    const mesh = child as THREE.Mesh;
    if (!mesh.isMesh) return;
    const m = mesh.material;
    if (Array.isArray(m)) {
      for (const mat of m) {
        (mat as THREE.MeshStandardMaterial).opacity = value;
      }
    } else if (m) {
      (m as THREE.MeshStandardMaterial).opacity = value;
    }
  });
}

function disposeRecursive(obj: THREE.Object3D) {
  obj.traverse((child) => {
    const mesh = child as THREE.Mesh;
    if (!mesh.isMesh) return;
    mesh.geometry?.dispose();
    const m = mesh.material;
    if (Array.isArray(m)) m.forEach((mat) => mat.dispose());
    else m?.dispose();
    // InstancedMesh has its own instance-matrix buffer that needs disposing
    // beyond the geometry/material — without this it leaks GPU memory.
    if ((child as THREE.InstancedMesh).isInstancedMesh) {
      (child as THREE.InstancedMesh).dispose();
    }
  });
}

/**
 * Procedural "pebbled leather" bump map. Generates a canvas filled with mid
 * gray, then sprinkles thousands of small radial-gradient bright dots over
 * it. Used as a `bumpMap` on the basketball and football so their surfaces
 * shimmer with the bumpy, dimpled texture you see on real leather (the same
 * effect a hand-stippled normal map gives, but procedural — no asset needed).
 *
 * Wraps with x4 horizontal repeat / x2 vertical so pole distortion on a
 * sphere stays subtle. Color space is forced to NoColorSpace because bump
 * maps are linear height data, not sRGB color.
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

function makeStandardMaterial(
  color: number,
  opts: {
    roughness?: number;
    metalness?: number;
    flat?: boolean;
    envMapIntensity?: number;
  } = {},
): THREE.MeshStandardMaterial {
  return new THREE.MeshStandardMaterial({
    color,
    roughness: opts.roughness ?? 0.5,
    metalness: opts.metalness ?? 0.05,
    flatShading: opts.flat ?? false,
    transparent: true,
    opacity: 0,
    envMapIntensity: opts.envMapIntensity ?? 1.0,
  });
}

// ---------- baseball --------------------------------------------------------

/**
 * Off-white cowhide sphere + 216 red angled cross-stitches placed along a
 * figure-8 seam curve via `InstancedMesh` (one capsule per stitch, alternating
 * tilt direction so adjacent stitches form the iconic zig-zag pattern).
 *
 * Why no central seam tube: a real baseball has no visible thread between
 * stitches — just the panel join. Drawing a continuous red ring would look
 * like piping rather than stitching, so we drop it and let the cross-stitch
 * cadence be the seam.
 *
 * Construction:
 *   1. Build the closed seam curve (φ = A·cos(2θ), θ = t) — classic
 *      tennis-ball/baseball wavy great circle that traces both seam lobes.
 *   2. Walk the curve at 216 evenly-spaced positions (~108 per lobe — what
 *      a real MLB ball has).
 *   3. At each position compute the Frenet frame on the sphere: tangent
 *      (curve direction), normal (radial out), binormal (perp on surface).
 *   4. Each stitch is a small capsule oriented along binormal + a tilt of
 *      ±0.5 along tangent (sign alternates each stitch). This produces the
 *      "//\\//\\" cross-stitching pattern you see on real cowhide.
 */
export function buildBaseball(): SportMesh {
  const group = new THREE.Group();
  const radius = 0.85;

  const sphereGeo = new THREE.SphereGeometry(radius, 128, 128);
  const sphereMat = makeStandardMaterial(0xfaf6ed, {
    roughness: 0.62,
    envMapIntensity: 0.85,
  });
  group.add(new THREE.Mesh(sphereGeo, sphereMat));

  // Seam curve — used purely as a parametric path for stitch placement.
  const seamPoints: THREE.Vector3[] = [];
  const SEAM_AMP = 0.62;
  const SAMPLES = 240;
  for (let i = 0; i < SAMPLES; i++) {
    const t = (i / SAMPLES) * Math.PI * 2;
    const phi = Math.cos(2 * t) * SEAM_AMP;
    const r = radius;
    seamPoints.push(
      new THREE.Vector3(
        r * Math.cos(phi) * Math.cos(t),
        r * Math.sin(phi),
        r * Math.cos(phi) * Math.sin(t),
      ),
    );
  }
  const seamCurve = new THREE.CatmullRomCurve3(seamPoints, true);

  const STITCH_COUNT = 216;
  const stitchGeo = new THREE.CapsuleGeometry(0.012, 0.075, 4, 8);
  const stitchMat = makeStandardMaterial(0xc62a25, {
    roughness: 0.55,
    envMapIntensity: 0.7,
  });
  const stitches = new THREE.InstancedMesh(stitchGeo, stitchMat, STITCH_COUNT);

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

    // Alternate tilt sign so consecutive stitches cross the seam from
    // opposite directions — that's what creates the zig-zag pattern.
    const tilt = i % 2 === 0 ? 0.55 : -0.55;
    tmpDir.copy(tmpBin).addScaledVector(tmpTan, tilt).normalize();

    // Sit stitches just above the surface so they're not buried by
    // floating-point precision in the radial projection.
    dummy.position.copy(pos).addScaledVector(tmpNorm, 0.014);
    tmpQuat.setFromUnitVectors(upY, tmpDir);
    dummy.quaternion.copy(tmpQuat);
    dummy.scale.setScalar(1);
    dummy.updateMatrix();
    stitches.setMatrixAt(i, dummy.matrix);
  }
  stitches.instanceMatrix.needsUpdate = true;
  group.add(stitches);

  return {
    object: group,
    spinAxis: "y",
    spinSpeed: 0.55,
    setOpacity(v) {
      setOpacityRecursive(group, v);
    },
    dispose() {
      disposeRecursive(group);
    },
  };
}

// ---------- bat -------------------------------------------------------------

/**
 * Lathe-revolved bat profile: knob at bottom → straight handle → taper out →
 * barrel → rounded tip. The 2D profile traces the silhouette of a real wood
 * bat (knob bulge, narrow handle ~10% radius, barrel ~25% radius).
 */
export function buildBat(): SportMesh {
  const group = new THREE.Group();
  const profile: THREE.Vector2[] = [
    new THREE.Vector2(0.0, -1.4),
    new THREE.Vector2(0.18, -1.4),
    new THREE.Vector2(0.18, -1.32),
    new THREE.Vector2(0.10, -1.28),
    new THREE.Vector2(0.10, -0.85),
    new THREE.Vector2(0.13, -0.45),
    new THREE.Vector2(0.20, 0.25),
    new THREE.Vector2(0.25, 1.05),
    new THREE.Vector2(0.22, 1.32),
    new THREE.Vector2(0.0, 1.42),
  ];
  const geometry = new THREE.LatheGeometry(profile, 64);
  geometry.computeVertexNormals();
  const material = makeStandardMaterial(0xc89668, {
    roughness: 0.55,
    envMapIntensity: 0.9,
  });
  const mesh = new THREE.Mesh(geometry, material);
  group.add(mesh);
  return {
    object: group,
    spinAxis: "y",
    spinSpeed: 0.6,
    setOpacity(v) {
      setOpacityRecursive(group, v);
    },
    dispose() {
      disposeRecursive(group);
    },
  };
}

// ---------- basketball ------------------------------------------------------

/**
 * Pebbled-leather orange sphere + four dark seam tubes (1 horizontal great
 * circle, 1 vertical, 2 tilted ±45° around y → 8-panel pattern). The pebbled
 * surface comes from a procedural bump map rather than a texture asset, and
 * is what turns the bare sphere from "smooth orange ball" into "real
 * basketball with leather grain catching the light".
 */
export function buildBasketball(): SportMesh {
  const group = new THREE.Group();
  const radius = 0.95;

  const bumpMap = makePebbleBumpMap(512, 0.05);

  const sphereGeo = new THREE.SphereGeometry(radius, 128, 128);
  const sphereMat = new THREE.MeshStandardMaterial({
    color: 0xd35221,
    roughness: 0.85,
    metalness: 0.04,
    bumpMap,
    bumpScale: 0.009,
    envMapIntensity: 0.65,
    transparent: true,
    opacity: 0,
  });
  group.add(new THREE.Mesh(sphereGeo, sphereMat));

  // Recessed-looking seam grooves: dark color, slightly thicker tube than
  // before so they're visible against the pebbled surface.
  const seamMat = makeStandardMaterial(0x1f0e07, {
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
    return new THREE.Mesh(geo, seamMat);
  };

  group.add(greatCircle(new THREE.Vector3(0, 1, 0)));
  group.add(greatCircle(new THREE.Vector3(1, 0, 0)));
  group.add(greatCircle(new THREE.Vector3(0, 0, 1).applyAxisAngle(new THREE.Vector3(0, 1, 0), Math.PI / 4)));
  group.add(greatCircle(new THREE.Vector3(0, 0, 1).applyAxisAngle(new THREE.Vector3(0, 1, 0), -Math.PI / 4)));

  return {
    object: group,
    spinAxis: "y",
    spinSpeed: 0.7,
    setOpacity(v) {
      setOpacityRecursive(group, v);
    },
    dispose() {
      disposeRecursive(group);
      bumpMap.dispose();
    },
  };
}

// ---------- football --------------------------------------------------------

/**
 * Prolate-spheroid pebbled-leather football with the iconic white stripe
 * bands near each tip and a row of thick white laces along the top seam.
 *
 * Geometry pipeline:
 *   - Start from a sphere of radius 0.7.
 *   - Stretch z by 1.7× and taper xy by `1 - (|z|/0.7)^4 · 0.55` so the
 *     tips pinch to points (quartic falloff = sharper tip than a quadratic).
 *
 * Surface detail:
 *   - Procedural pebble bump map (same helper as the basketball, slightly
 *     denser) gives leather grain.
 *   - Two white TubeGeometry rings at z = ±0.85 — radius computed analytically
 *     from the deformation formula so they sit flush on the surface, not
 *     floating above or biting into it.
 *   - 7 thick white capsules along z ∈ [-0.275, +0.275] above the seam,
 *     each oriented horizontally — the visible "laces" you grip.
 */
export function buildFootball(): SportMesh {
  const group = new THREE.Group();

  const SPHERE_R = 0.7;
  const Z_STRETCH = 1.7;
  const TIP_FALLOFF = 0.55;

  // Analytic xy radius of the deformed surface at a given world-z.
  // Inverse of the deformation: world_z = sphere_z * Z_STRETCH, so
  // sphere_z = world_z / Z_STRETCH. Then xy_orig = √(R² - sphere_z²) and
  // tip_factor = 1 - (|sphere_z|/R)^4 · TIP_FALLOFF.
  const xyRadiusAt = (worldZ: number) => {
    const sz = worldZ / Z_STRETCH;
    if (Math.abs(sz) >= SPHERE_R) return 0;
    const xyOrig = Math.sqrt(SPHERE_R * SPHERE_R - sz * sz);
    const tipF = 1 - Math.pow(Math.abs(sz) / SPHERE_R, 4) * TIP_FALLOFF;
    return xyOrig * tipF;
  };

  const ballGeo = new THREE.SphereGeometry(SPHERE_R, 128, 128);
  const pos = ballGeo.attributes.position;
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i);
    const y = pos.getY(i);
    const z = pos.getZ(i);
    const newZ = z * Z_STRETCH;
    const tipFactor = 1 - Math.pow(Math.abs(z) / SPHERE_R, 4) * TIP_FALLOFF;
    pos.setXYZ(i, x * tipFactor, y * tipFactor, newZ);
  }
  pos.needsUpdate = true;
  ballGeo.computeVertexNormals();

  const bumpMap = makePebbleBumpMap(512, 0.055);
  const ballMat = new THREE.MeshStandardMaterial({
    color: 0x6b2f17,
    roughness: 0.7,
    metalness: 0.04,
    bumpMap,
    bumpScale: 0.006,
    envMapIntensity: 0.85,
    transparent: true,
    opacity: 0,
  });
  group.add(new THREE.Mesh(ballGeo, ballMat));

  // White stripe bands near each tip — thick TubeGeometry rings whose radius
  // matches the deformed ellipsoid's local cross-section at that z.
  const stripeMat = makeStandardMaterial(0xefe9da, {
    roughness: 0.55,
    envMapIntensity: 0.7,
  });
  const stripeOffset = 0.005;
  for (const stripeZ of [0.88, -0.88]) {
    const ringR = xyRadiusAt(stripeZ) + stripeOffset;
    if (ringR <= 0) continue;
    const stripePts: THREE.Vector3[] = [];
    const SEG = 96;
    for (let i = 0; i < SEG; i++) {
      const t = (i / SEG) * Math.PI * 2;
      stripePts.push(new THREE.Vector3(Math.cos(t) * ringR, Math.sin(t) * ringR, stripeZ));
    }
    const stripeCurve = new THREE.CatmullRomCurve3(stripePts, true);
    const stripeGeo = new THREE.TubeGeometry(stripeCurve, 128, 0.055, 10, true);
    group.add(new THREE.Mesh(stripeGeo, stripeMat));
  }

  // Laces — row of thick white capsules sitting on top of the football
  // (along +y) right above the seam. CapsuleGeometry's default axis is +Y,
  // so we rotate around z by π/2 to lay them horizontally along the x-axis.
  const laceMat = makeStandardMaterial(0xf5f1e6, {
    roughness: 0.4,
    envMapIntensity: 0.7,
  });
  const NUM_LACES = 7;
  const LACE_SPAN = 0.55;
  for (let i = 0; i < NUM_LACES; i++) {
    const t = i / (NUM_LACES - 1);
    const laceZ = (t - 0.5) * LACE_SPAN;
    const yTop = xyRadiusAt(laceZ);
    const laceGeo = new THREE.CapsuleGeometry(0.022, 0.13, 6, 12);
    const lace = new THREE.Mesh(laceGeo, laceMat);
    lace.position.set(0, yTop + 0.012, laceZ);
    lace.rotation.z = Math.PI / 2;
    group.add(lace);
  }

  // Tilt slightly so the laces are visible from the default camera angle.
  group.rotation.z = Math.PI / 14;
  group.rotation.x = -Math.PI / 18;

  return {
    object: group,
    spinAxis: "z",
    spinSpeed: 0.55,
    setOpacity(v) {
      setOpacityRecursive(group, v);
    },
    dispose() {
      disposeRecursive(group);
      bumpMap.dispose();
    },
  };
}

// ---------- soccer ball -----------------------------------------------------

/**
 * Build a real truncated icosahedron (32 faces: 12 pentagons + 20 hexagons)
 * by truncating the 12 vertices of an icosahedron at 1/3 along each edge.
 *
 * Construction:
 *   1. Generate the 12 icosahedron vertex positions (golden-ratio coords).
 *   2. List the 20 triangular faces and derive the 30 unique edges from them.
 *   3. For each edge (a→b), insert two truncation points: one at 1/3 from a
 *      and one at 2/3 from a (= 1/3 from b). That's 60 truncated vertices.
 *   4. PENTAGONS: for each ico vertex v, gather the 5 truncation points on
 *      its 5 incident edges that are "near v". Order them by angular position
 *      around v in the tangent plane.
 *   5. HEXAGONS: for each ico face (a, b, c), the hexagon has 6 vertices —
 *      the two truncation points from each of the 3 edges, walked around in
 *      a→b→c→a order.
 *   6. Build a single BufferGeometry with two material groups: pentagons map
 *      to material[0] (black), hexagons to material[1] (white). Project all
 *      vertices to the sphere of `radius` for a true ball shape.
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
  // For each edge + ico-vertex end, look up the index of the truncation point
  // on that edge nearest that end.
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
      va[0] + (vb[0] - va[0]) * 2 / 3,
      va[1] + (vb[1] - va[1]) * 2 / 3,
      va[2] + (vb[2] - va[2]) * 2 / 3,
    ];
    const ia = truncPoints.push(pa) - 1;
    const ib = truncPoints.push(pb) - 1;
    lookup.set(`${key}:${a}`, ia);
    lookup.set(`${key}:${b}`, ib);
  }

  // Adjacency: for each ico vertex, which other vertices share an edge.
  const neighbors: number[][] = Array.from({ length: 12 }, () => []);
  for (const key of edges) {
    const [a, b] = key.split("-").map(Number);
    neighbors[a].push(b);
    neighbors[b].push(a);
  }

  // Order each ico vertex's neighbors by angular position around it in the
  // tangent plane (so pentagons wind consistently CCW from outside).
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

  // Pentagons: 12 of them, one per ico vertex.
  const pentagonFaces: number[][] = [];
  for (let v = 0; v < 12; v++) {
    const pent: number[] = [];
    for (const nb of orderedNeighbors[v]) {
      const pi = lookup.get(`${edgeKey(v, nb)}:${v}`);
      if (pi !== undefined) pent.push(pi);
    }
    if (pent.length === 5) pentagonFaces.push(pent);
  }

  // Hexagons: 20 of them, one per ico face. Walk a→b→c→a and pick up both
  // truncation points along each edge.
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

  // Project every truncation point onto the sphere of `radius`, build the
  // attributes. Normals point radially outward (smooth shading on a sphere).
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
  // Fan-triangulate each polygon face.
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
  // Material 0 = pentagons, material 1 = hexagons.
  geometry.addGroup(0, pentTris * 3, 0);
  geometry.addGroup(pentTris * 3, hexTris * 3, 1);
  return geometry;
}

export function buildSoccerBall(): SportMesh {
  const group = new THREE.Group();
  const radius = 0.9;

  // Base ball with the truncated-icosahedron panel coloring.
  const panelGeo = buildTruncatedIcosahedronGeometry(radius * 0.998);
  const blackPanelMat = makeStandardMaterial(0x111111, {
    roughness: 0.6,
    envMapIntensity: 0.6,
  });
  const whitePanelMat = makeStandardMaterial(0xf4f4f4, {
    roughness: 0.55,
    envMapIntensity: 0.85,
  });
  const panels = new THREE.Mesh(panelGeo, [blackPanelMat, whitePanelMat]);
  group.add(panels);

  // Slight underlay sphere in case the truncated polyhedron leaves any visible
  // cracks at the seams (it shouldn't with the sphere projection, but the
  // underlay is cheap insurance).
  const underGeo = new THREE.SphereGeometry(radius * 0.97, 64, 64);
  const underMat = makeStandardMaterial(0x222222, { roughness: 0.7 });
  group.add(new THREE.Mesh(underGeo, underMat));

  return {
    object: group,
    spinAxis: "y",
    spinSpeed: 0.55,
    setOpacity(v) {
      setOpacityRecursive(group, v);
    },
    dispose() {
      disposeRecursive(group);
    },
  };
}

// ---------- hockey puck -----------------------------------------------------

/**
 * Short flat black cylinder + a thin secondary band ring around the rim to
 * suggest the embossed brand band you see on a real puck (without showing any
 * actual brand mark). Tilted onto its side and pitched so the rim is visible
 * to the camera.
 */
export function buildHockeyPuck(): SportMesh {
  const group = new THREE.Group();
  const r = 0.85;
  const h = 0.32;

  const bodyGeo = new THREE.CylinderGeometry(r, r, h, 96);
  const bodyMat = makeStandardMaterial(0x121212, {
    roughness: 0.45,
    metalness: 0.15,
    envMapIntensity: 0.6,
  });
  group.add(new THREE.Mesh(bodyGeo, bodyMat));

  // Decorative band around the rim (a short cylindrical sleeve, slightly
  // proud of the surface, in a softer black).
  const bandGeo = new THREE.CylinderGeometry(r * 1.005, r * 1.005, h * 0.45, 96, 1, true);
  const bandMat = makeStandardMaterial(0x2a2a2a, {
    roughness: 0.55,
    metalness: 0.05,
  });
  group.add(new THREE.Mesh(bandGeo, bandMat));

  // Lay it on its side (cylinder default axis is +Y; rotate around Z to tip
  // it onto X, then pitch slightly so we see the round face at an angle).
  group.rotation.z = Math.PI / 2;
  group.rotation.x = Math.PI / 7;

  return {
    object: group,
    spinAxis: "x",
    spinSpeed: 0.8,
    setOpacity(v) {
      setOpacityRecursive(group, v);
    },
    dispose() {
      disposeRecursive(group);
    },
  };
}
