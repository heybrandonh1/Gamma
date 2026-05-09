import * as THREE from "three";

import {
  makeCylinderDist,
  makeFootballDist,
  makeSphereDist,
  type SurfaceDistanceFn,
} from "./surface-distance";

/**
 * Per-sport "what does this object look like at every direction on the
 * sphere" specs.
 *
 * The unified single-mesh morpher samples a high-res sphere at mount time
 * and asks each sport, for every vertex direction `d`:
 *   - `surfaceDist(d)` — how far from origin the surface lives (silhouette).
 *   - `colorAt(d)` — the surface albedo at that direction (body + any
 *      decorative pattern like baseball stitches, basketball seams,
 *      football laces, soccer panels, hockey rim band).
 *
 * Both signals get baked into per-sport `Float32Array`s the unified mesh
 * holds in two slot pairs (A and B). The vertex shader interpolates
 * `mix(aPosA, aPosB, smoothstep(uBlend))` and `mix(aColA, aColB, smoothstep(uBlend))`
 * — the morph is a single continuous lerp on each per-vertex channel. No
 * overlapping meshes, no opacity crossfade, no decorations popping in
 * and out. The body silhouette and the painted-on details flow into the
 * next sport like a lava-lamp blob.
 */
export interface SportSpec {
  key: string;
  name: string;
  surfaceDist: SurfaceDistanceFn;
  /**
   * Albedo at unit direction `d`. Returns `(r, g, b)` in linear-ish 0..1.
   * Free to mix base body color with procedural decoration (stitches,
   * seams, panels, laces) — the decoration is encoded in the per-vertex
   * color, not as a separate mesh, so it morphs along with the silhouette
   * automatically.
   */
  colorAt(dx: number, dy: number, dz: number, out: THREE.Color): void;
  /** Hex color used to tint the rim point-light when this frame is active. */
  rimColor: string;
  /** Auto-rotation axis. */
  spinAxis: "x" | "y" | "z";
  /** Auto-rotation speed in rad/s. */
  spinSpeed: number;
  /** Material tuning — the morpher interpolates these per-frame too. */
  roughness: number;
  metalness: number;
  envMapIntensity: number;
}

const C = {
  baseballBody: new THREE.Color(0xfaf6ed),
  baseballStitch: new THREE.Color(0xc62a25),
  basketballBody: new THREE.Color(0xd35221),
  basketballSeam: new THREE.Color(0x2a160c),
  footballBody: new THREE.Color(0x6c3a1b),
  footballLace: new THREE.Color(0xf2efe4),
  soccerWhite: new THREE.Color(0xf4f4f4),
  soccerBlack: new THREE.Color(0x111111),
  hockeyBody: new THREE.Color(0x121212),
  hockeyRim: new THREE.Color(0x2a2a2a),
};

// ---------- baseball --------------------------------------------------------

const BASEBALL_RADIUS = 0.85;
const BASEBALL_SEAM_AMP = 0.62;

/**
 * Walk the figure-8 seam curve at high resolution and look up the closest
 * sample for each vertex direction. The seam is `φ = A·cos(2θ)` — a wavy
 * great-circle that loops around the ball twice, the same curve real
 * baseball stitches sit along.
 *
 * The sample buffer is built at module load and reused across every
 * baseball-bound vertex, so the per-vertex cost in `colorAt` is just one
 * loop over 240 samples instead of any seam-curve math.
 */
const BASEBALL_SEAM_SAMPLES: { x: number; y: number; z: number; s: number }[] = (() => {
  const out: { x: number; y: number; z: number; s: number }[] = [];
  const N = 240;
  for (let i = 0; i < N; i++) {
    const t = (i / N) * Math.PI * 2;
    const phi = Math.cos(2 * t) * BASEBALL_SEAM_AMP;
    out.push({
      x: Math.cos(phi) * Math.cos(t),
      y: Math.sin(phi),
      z: Math.cos(phi) * Math.sin(t),
      s: i,
    });
  }
  return out;
})();

function baseballColor(dx: number, dy: number, dz: number, out: THREE.Color): void {
  // Find nearest seam sample on the unit sphere via dot product (samples
  // are already unit length).
  let bestDot = -2;
  let bestS = 0;
  for (const sample of BASEBALL_SEAM_SAMPLES) {
    const d = sample.x * dx + sample.y * dy + sample.z * dz;
    if (d > bestDot) {
      bestDot = d;
      bestS = sample.s;
    }
  }
  // Angular distance to the seam curve (radians on the unit sphere).
  const ang = Math.acos(Math.min(1, Math.max(-1, bestDot)));
  // Stitch cadence along the seam: 216 stitches over 240 samples, with
  // alternating slash direction. Rendered as a wide-then-narrow band so
  // the cross-stitch zigzag reads from any angle.
  const stitchPhase = (bestS / 240) * 216;
  const stitchPulse = Math.abs(Math.sin(stitchPhase * Math.PI));
  // Stitch envelope: only if we're close to the seam AND the stitch pulse
  // says "we're on a stitch", paint red.
  const nearSeam = Math.exp(-(ang * ang) / 0.0035);
  const stitch = nearSeam * (0.55 + 0.45 * stitchPulse);
  out.copy(C.baseballBody).lerp(C.baseballStitch, Math.min(1, stitch));
}

// ---------- basketball ------------------------------------------------------

const BASKETBALL_RADIUS = 0.95;

/**
 * Four great-circle seam normals. The basketball's surface seams sit on
 * each plane `n · p = 0`, so the angular distance from any unit direction
 * `d` to the closest seam is `min over i of |asin(d · nᵢ)|` ≈ `min |d · nᵢ|`
 * for small angles — close enough since the seams are thin.
 */
const BASKETBALL_SEAM_NORMALS: [number, number, number][] = (() => {
  // 1 horizontal great circle, 1 vertical, 2 tilted ±45° around y.
  const v1: [number, number, number] = [0, 1, 0];
  const v2: [number, number, number] = [1, 0, 0];
  const a = Math.cos(Math.PI / 4);
  const b = Math.sin(Math.PI / 4);
  // (0, 0, 1) rotated ±45° around y: (sin θ, 0, cos θ).
  const v3: [number, number, number] = [b, 0, a];
  const v4: [number, number, number] = [-b, 0, a];
  return [v1, v2, v3, v4];
})();

function basketballColor(dx: number, dy: number, dz: number, out: THREE.Color): void {
  let minAbs = 1.0;
  for (const n of BASKETBALL_SEAM_NORMALS) {
    const v = Math.abs(dx * n[0] + dy * n[1] + dz * n[2]);
    if (v < minAbs) minAbs = v;
  }
  // Seam falloff: when |d · n| < ~0.025 the vertex sits on a seam.
  const seam = Math.exp(-(minAbs * minAbs) / 0.0008);
  out.copy(C.basketballBody).lerp(C.basketballSeam, Math.min(1, seam));
}

// ---------- football --------------------------------------------------------

const FOOTBALL_BASE_R = 0.7;
const FOOTBALL_Z_STRETCH = 1.7;
const FOOTBALL_TIP_FALLOFF = 0.55;

/**
 * The football's lace strip lives on the top of the prolate spheroid at
 * roughly y ≈ 0.9·R for z ∈ [-0.28, +0.28] (in the same coords the mesh
 * uses), with 7 cross stitches running across the strip every ~0.07 in z.
 *
 * Surface-distance sampled at the prolate spheroid's actual surface, so
 * we match the real football's geometry — not a hand-tuned approximation.
 */
function footballColor(dx: number, dy: number, dz: number, out: THREE.Color): void {
  // Project the unit direction onto the football surface to find where
  // this vertex lives in the football's coordinate frame.
  // Approx: if `dx,dy,dz` were on a unit sphere, the corresponding
  // football vertex is `(dx·R·tipF, dy·R·tipF, dz·R·zStretch)` where
  // `tipF = 1 - |dz|^4·tipFalloff`. We just need the y-coord of the
  // football surface at this direction to test against the lace strip.
  const tipF = 1 - Math.pow(Math.abs(dz), 4) * FOOTBALL_TIP_FALLOFF;
  const yOnSurface = dy * FOOTBALL_BASE_R * tipF;
  const zOnSurface = dz * FOOTBALL_BASE_R * FOOTBALL_Z_STRETCH;
  // Lace strip lives along +y at z in [-0.476, 0.476] (FOOTBALL_BASE_R*0.28*SCALE
  // with SCALE = R/0.32; the original mesh used z·0.28 in normalized units).
  const stripZHalf = 0.55;
  const stripY = FOOTBALL_BASE_R * 0.9;
  const inStripZ = Math.abs(zOnSurface) < stripZHalf ? 1 : 0;
  // Only the +y hemisphere has the strip. Distance from the strip line.
  const dy_strip = yOnSurface - stripY;
  const distToStrip = Math.hypot(dy_strip, 0); // y distance only since strip is along z
  const onStrip = inStripZ * Math.exp(-(distToStrip * distToStrip) / 0.005);
  // Cross stitches: 7 along z, evenly spaced.
  const crossPeriod = (stripZHalf * 2) / 7;
  const nearestCrossZ = Math.round(zOnSurface / crossPeriod) * crossPeriod;
  const distToCrossZ = Math.abs(zOnSurface - nearestCrossZ);
  const onCross = inStripZ * Math.exp(-(distToCrossZ * distToCrossZ) / 0.001) *
    Math.exp(-(dy_strip * dy_strip) / 0.012);
  const lace = Math.min(1, Math.max(onStrip, onCross));
  out.copy(C.footballBody).lerp(C.footballLace, lace);
}

// ---------- soccer ball -----------------------------------------------------

const SOCCER_RADIUS = 0.9;

/**
 * Twelve normalized icosahedron vertex directions — the pentagon centers
 * of a truncated-icosahedron soccer ball. Each pentagon caps an
 * angular-radius spherical disk; everything between disks is a hexagon
 * panel, so the panel pattern reduces to "is this direction inside
 * pentagon `i` or not?".
 */
const SOCCER_PENTAGON_CENTERS: [number, number, number][] = (() => {
  const phi = (1 + Math.sqrt(5)) / 2;
  const raw: [number, number, number][] = [
    [-1, phi, 0], [1, phi, 0], [-1, -phi, 0], [1, -phi, 0],
    [0, -1, phi], [0, 1, phi], [0, -1, -phi], [0, 1, -phi],
    [phi, 0, -1], [phi, 0, 1], [-phi, 0, -1], [-phi, 0, 1],
  ];
  return raw.map(([x, y, z]) => {
    const len = Math.hypot(x, y, z);
    return [x / len, y / len, z / len] as [number, number, number];
  });
})();

const SOCCER_PENTAGON_HALF_ANGLE = 0.39;

function soccerColor(dx: number, dy: number, dz: number, out: THREE.Color): void {
  let bestDot = -2;
  for (const c of SOCCER_PENTAGON_CENTERS) {
    const d = dx * c[0] + dy * c[1] + dz * c[2];
    if (d > bestDot) bestDot = d;
  }
  const ang = Math.acos(Math.min(1, Math.max(-1, bestDot)));
  // Pentagon = black inside its angular disk; hexagon (white) outside.
  // Smoothstep keeps the boundary anti-aliased.
  const t = 1 - smoothstep(SOCCER_PENTAGON_HALF_ANGLE - 0.02,
    SOCCER_PENTAGON_HALF_ANGLE + 0.02, ang);
  out.copy(C.soccerWhite).lerp(C.soccerBlack, t);
}

function smoothstep(edge0: number, edge1: number, x: number): number {
  const t = Math.min(1, Math.max(0, (x - edge0) / (edge1 - edge0)));
  return t * t * (3 - 2 * t);
}

// ---------- hockey puck -----------------------------------------------------

const HOCKEY_RADIUS = 0.85;
const HOCKEY_HALF_HEIGHT = 0.16;

/**
 * Cylinder along +X. The rim band is a horizontal stripe across the
 * cylinder's side, between roughly the middle 45% of the height.
 * Otherwise the puck is uniform black.
 */
function hockeyPuckColor(
  dx: number,
  dy: number,
  dz: number,
  out: THREE.Color,
): void {
  // Decide if this direction hits the cylinder side (rim) or one of the
  // flat caps.
  const rho = Math.sqrt(dy * dy + dz * dz);
  const tSide = rho > 1e-6 ? HOCKEY_RADIUS / rho : Infinity;
  const tCap = Math.abs(dx) > 1e-6 ? HOCKEY_HALF_HEIGHT / Math.abs(dx) : Infinity;
  if (tSide < tCap) {
    // We're on the cylinder side. The rim band is the middle 45% of the
    // side's "x extent"; for a side hit, x_at_t = dx · tSide ∈
    // [-halfHeight, halfHeight]. The band lives in the inner 45%.
    const xOnSide = dx * tSide;
    const t = Math.abs(xOnSide) / HOCKEY_HALF_HEIGHT;
    const onBand = t < 0.45 ? 1 : 0;
    out.copy(C.hockeyBody).lerp(C.hockeyRim, onBand * 0.55);
  } else {
    out.copy(C.hockeyBody);
  }
}

// ---------- catalogue -------------------------------------------------------

export const SPORT_SPECS: SportSpec[] = [
  {
    key: "baseball",
    name: "Baseball",
    surfaceDist: makeSphereDist(BASEBALL_RADIUS),
    colorAt: baseballColor,
    rimColor: "#ffd58a",
    spinAxis: "y",
    spinSpeed: 0.55,
    roughness: 0.62,
    metalness: 0.05,
    envMapIntensity: 0.85,
  },
  {
    key: "basketball",
    name: "Basketball",
    surfaceDist: makeSphereDist(BASKETBALL_RADIUS),
    colorAt: basketballColor,
    rimColor: "#ff8a3a",
    spinAxis: "y",
    spinSpeed: 0.7,
    roughness: 0.85,
    metalness: 0.04,
    envMapIntensity: 0.65,
  },
  {
    key: "football",
    name: "Football",
    surfaceDist: makeFootballDist(
      FOOTBALL_BASE_R,
      FOOTBALL_Z_STRETCH,
      FOOTBALL_TIP_FALLOFF,
    ),
    colorAt: footballColor,
    rimColor: "#d4a36d",
    spinAxis: "z",
    spinSpeed: 0.55,
    roughness: 0.7,
    metalness: 0,
    envMapIntensity: 1.0,
  },
  {
    key: "soccer",
    name: "Soccer Ball",
    surfaceDist: makeSphereDist(SOCCER_RADIUS),
    colorAt: soccerColor,
    rimColor: "#cfdcff",
    spinAxis: "y",
    spinSpeed: 0.55,
    roughness: 0.55,
    metalness: 0,
    envMapIntensity: 1.0,
  },
  {
    key: "hockey",
    name: "Hockey Puck",
    surfaceDist: makeCylinderDist(HOCKEY_RADIUS, HOCKEY_HALF_HEIGHT, "x"),
    colorAt: hockeyPuckColor,
    rimColor: "#9fb4cc",
    spinAxis: "x",
    spinSpeed: 0.8,
    roughness: 0.45,
    metalness: 0.15,
    envMapIntensity: 0.6,
  },
];
