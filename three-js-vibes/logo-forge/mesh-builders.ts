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
 * the scene applies in `logo-forge.tsx`, MeshStandardMaterial picks up real
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
  });
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
 * Cream-white sphere + red stitch curve. The stitch curve is the classic
 * baseball figure-8 seam, parameterized as a wavy great-circle on the sphere
 * surface (latitude oscillates as a sine of double-longitude, giving the
 * tennis-ball-style two-lobe seam). The TubeGeometry hugs the surface with a
 * tiny outward bump so it doesn't z-fight the underlying sphere.
 */
export function buildBaseball(): SportMesh {
  const group = new THREE.Group();
  const radius = 0.85;

  const sphereGeo = new THREE.SphereGeometry(radius, 96, 96);
  const sphereMat = makeStandardMaterial(0xfff4dc, {
    roughness: 0.55,
    envMapIntensity: 0.85,
  });
  const sphere = new THREE.Mesh(sphereGeo, sphereMat);
  group.add(sphere);

  // Build the seam curve: classic tennis-ball/baseball wavy great circle.
  // φ(t) = A·cos(2t), θ(t) = t — gives a single closed loop that crosses
  // itself visually as two opposing C-arcs when viewed from one side.
  const seamPoints: THREE.Vector3[] = [];
  const SEAM_AMP = 0.62;
  const SEG = 240;
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
  const seamCurve = new THREE.CatmullRomCurve3(seamPoints, /*closed*/ true);
  const seamGeo = new THREE.TubeGeometry(seamCurve, 320, 0.018, 10, true);
  const seamMat = makeStandardMaterial(0xc8302b, { roughness: 0.45 });
  const seam = new THREE.Mesh(seamGeo, seamMat);
  group.add(seam);

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
 * Orange sphere + four dark seam tubes: one vertical great circle, one
 * horizontal great circle, plus two great circles tilted at ±45° around the
 * vertical axis to mimic the iconic eight-panel pattern.
 */
export function buildBasketball(): SportMesh {
  const group = new THREE.Group();
  const radius = 0.95;

  const sphereGeo = new THREE.SphereGeometry(radius, 96, 96);
  const sphereMat = makeStandardMaterial(0xff6f23, {
    roughness: 0.78,
    envMapIntensity: 0.7,
  });
  group.add(new THREE.Mesh(sphereGeo, sphereMat));

  const seamMat = makeStandardMaterial(0x2b1608, { roughness: 0.6 });

  // Helper: build a great-circle seam tube for a given normal direction.
  // The seam lies in the plane perpendicular to `normal`, projected onto the
  // sphere of radius `radius * 1.005` so it sits just above the surface.
  const greatCircle = (normal: THREE.Vector3) => {
    const n = normal.clone().normalize();
    // Build a basis (u, v) for the plane perpendicular to n.
    const ref = Math.abs(n.x) < 0.9
      ? new THREE.Vector3(1, 0, 0)
      : new THREE.Vector3(0, 1, 0);
    const u = new THREE.Vector3().crossVectors(n, ref).normalize();
    const v = new THREE.Vector3().crossVectors(n, u).normalize();
    const pts: THREE.Vector3[] = [];
    const r = radius * 1.005;
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
    const geo = new THREE.TubeGeometry(curve, 256, 0.014, 8, true);
    return new THREE.Mesh(geo, seamMat);
  };

  group.add(greatCircle(new THREE.Vector3(0, 1, 0))); // horizontal "equator"
  group.add(greatCircle(new THREE.Vector3(1, 0, 0))); // vertical (around x)
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
    },
  };
}

// ---------- football --------------------------------------------------------

/**
 * Prolate spheroid (sphere stretched and pinched at the ends) + a white lace
 * strip down the middle with perpendicular stitches.
 */
export function buildFootball(): SportMesh {
  const group = new THREE.Group();

  const ballGeo = new THREE.SphereGeometry(0.7, 96, 96);
  const pos = ballGeo.attributes.position;
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i);
    const y = pos.getY(i);
    const z = pos.getZ(i);
    const newZ = z * 1.7;
    const tipFactor = 1 - Math.pow(Math.abs(z) / 0.7, 4) * 0.55;
    pos.setXYZ(i, x * tipFactor, y * tipFactor, newZ);
  }
  pos.needsUpdate = true;
  ballGeo.computeVertexNormals();
  const ballMat = makeStandardMaterial(0x6c3a1b, {
    roughness: 0.7,
    envMapIntensity: 0.8,
  });
  group.add(new THREE.Mesh(ballGeo, ballMat));

  // Laces: a short white strip running along +y (top of ball) plus 6 cross
  // stitches. The strip is a thin tube along the y-axis, sitting just above
  // the ball surface near z ≈ 0.
  const laceMat = makeStandardMaterial(0xf2efe4, { roughness: 0.45 });
  const stripPts: THREE.Vector3[] = [];
  for (let i = 0; i <= 24; i++) {
    const t = (i / 24) * 2 - 1; // -1..1
    stripPts.push(new THREE.Vector3(0, 0.62 - 0.02 * t * t, t * 0.55));
  }
  const stripCurve = new THREE.CatmullRomCurve3(stripPts);
  const stripGeo = new THREE.TubeGeometry(stripCurve, 60, 0.012, 8, false);
  group.add(new THREE.Mesh(stripGeo, laceMat));

  // Cross stitches — short horizontal tubes perpendicular to the strip.
  for (let i = 0; i < 7; i++) {
    const t = i / 6;
    const z = (t * 2 - 1) * 0.4;
    const stitchPts = [
      new THREE.Vector3(-0.06, 0.625 - 0.01 * (z * z), z),
      new THREE.Vector3(0.06, 0.625 - 0.01 * (z * z), z),
    ];
    const stitchCurve = new THREE.CatmullRomCurve3(stitchPts);
    const stitchGeo = new THREE.TubeGeometry(stitchCurve, 8, 0.014, 6, false);
    group.add(new THREE.Mesh(stitchGeo, laceMat));
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
