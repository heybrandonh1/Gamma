import * as THREE from "three";

import {
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
  cricketBody: new THREE.Color(0x8a1822),
  cricketSeam: new THREE.Color(0x2c0608),
  cricketStitch: new THREE.Color(0xfaf3df),
  tennisBody: new THREE.Color(0xd6e84a),
  tennisSeam: new THREE.Color(0xf6f4e8),
  golfBody: new THREE.Color(0xf4f3ec),
  volleyballWhite: new THREE.Color(0xf6f6f1),
  volleyballBlue: new THREE.Color(0x1d3a8a),
  volleyballYellow: new THREE.Color(0xf2c63a),
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

// ---------- cricket ball ----------------------------------------------------

const CRICKET_RADIUS = 0.86;
/** Half-count of stitches around the great-circle equator seam. */
const CRICKET_STITCH_COUNT = 84;

/**
 * The cricket ball has a single raised great-circle seam running around
 * the equator (the `dy = 0` plane). Along that seam sits a row of small
 * white stitches — the most distinctive visual feature, alternating
 * between long and short stitches like the real construction.
 *
 * For a vertex direction `(dx, dy, dz)`:
 *   - `|dy|` is the angular distance to the seam plane.
 *   - `atan2(dz, dx)` is the azimuth around the seam.
 *
 * We darken a thin equatorial band as the seam itself, then paint
 * discrete white stitch marks at integer multiples of the stitch
 * angular period (with each stitch a short rectangle that's wider
 * across the seam than along it).
 */
function cricketColor(dx: number, dy: number, dz: number, out: THREE.Color): void {
  out.copy(C.cricketBody);
  // Tip darkening at the poles (away from the seam) for a worn,
  // hand-polished look.
  const polish = 1 - 0.12 * Math.pow(Math.abs(dy), 4);
  out.multiplyScalar(polish);

  // Equatorial seam: darker leather where the two halves stitch
  // together. `|dy|` is the angular distance to the seam plane on a
  // unit sphere.
  const seamMask = Math.exp(-(dy * dy) / 0.0008);
  out.lerp(C.cricketSeam, seamMask * 0.55);

  // Discrete stitches along the seam. Position around the seam is
  // azimuth `phi = atan2(dz, dx)`; we compute fraction within one
  // stitch period and paint a small white bar in the central "on"
  // window of each period. Bar shape: wider perpendicular to the
  // seam (along dy) than along it (along phi) so each stitch reads
  // as a short cross-stitch.
  const phi = Math.atan2(dz, dx);
  const stitchPeriod = (2 * Math.PI) / CRICKET_STITCH_COUNT;
  const stitchPos = (phi + Math.PI) / stitchPeriod;
  const stitchFrac = stitchPos - Math.floor(stitchPos);
  // Each stitch occupies the middle 40% of its period.
  const stitchOn = stitchFrac > 0.30 && stitchFrac < 0.70 ? 1 : 0;
  // Stitches sit on the seam: also require `|dy|` to be small.
  const onSeam = Math.exp(-(dy * dy) / 0.00045);
  out.lerp(C.cricketStitch, stitchOn * onSeam);
}

// ---------- tennis ball -----------------------------------------------------

const TENNIS_RADIUS = 0.92;
const TENNIS_SEAM_AMP = 0.62;

/**
 * The tennis ball's wishbone seam is the same `φ = A · cos(2θ)` figure-8
 * curve that real tennis balls use (and the same family the baseball's
 * seam belongs to), but rendered as a thicker continuous painted
 * white line rather than discrete stitches — that's what reads as
 * "tennis ball seam" vs. "baseball stitches".
 */
const TENNIS_SEAM_SAMPLES: { x: number; y: number; z: number }[] = (() => {
  const out: { x: number; y: number; z: number }[] = [];
  const N = 240;
  for (let i = 0; i < N; i++) {
    const t = (i / N) * Math.PI * 2;
    const phi = Math.cos(2 * t) * TENNIS_SEAM_AMP;
    out.push({
      x: Math.cos(phi) * Math.cos(t),
      y: Math.sin(phi),
      z: Math.cos(phi) * Math.sin(t),
    });
  }
  return out;
})();

function tennisColor(dx: number, dy: number, dz: number, out: THREE.Color): void {
  out.copy(C.tennisBody);

  // Subtle felt variation: very gentle radial falloff toward the poles
  // so the felted yellow doesn't read as flat plastic.
  const feltShade = 1 - 0.06 * Math.abs(dy);
  out.multiplyScalar(feltShade);

  // Distance to nearest seam sample on the figure-8 curve.
  let bestDot = -2;
  for (const sample of TENNIS_SEAM_SAMPLES) {
    const d = sample.x * dx + sample.y * dy + sample.z * dz;
    if (d > bestDot) bestDot = d;
  }
  const ang = Math.acos(Math.min(1, Math.max(-1, bestDot)));
  // Wider, smoother seam than the baseball — paints continuously
  // instead of in stitch beats.
  const seamMask = Math.exp(-(ang * ang) / 0.005);
  out.lerp(C.tennisSeam, Math.min(1, seamMask * 1.05));
}

// ---------- golf ball -------------------------------------------------------

const GOLF_RADIUS = 0.84;
const GOLF_DIMPLE_COUNT = 320;
/** Angular radius of each dimple on the unit sphere (radians). */
const GOLF_DIMPLE_R = 0.085;

/**
 * Fibonacci-sphere distribution of dimple centers. The golden-angle
 * spiral gives near-uniform density across the whole sphere, which
 * is what makes the dimple pattern read as regular without any
 * obvious latitude / longitude grid — the same trick the real
 * dimple-pattern designs lean on.
 *
 * 320 dimples × ~33k vertices = ~10M dot-products at mount time,
 * which JS handles in ~150 ms — paid once, never per frame.
 */
const GOLF_DIMPLE_CENTERS: [number, number, number][] = (() => {
  const out: [number, number, number][] = [];
  const goldenAngle = Math.PI * (3 - Math.sqrt(5));
  for (let i = 0; i < GOLF_DIMPLE_COUNT; i++) {
    const y = 1 - (i / (GOLF_DIMPLE_COUNT - 1)) * 2;
    const r = Math.sqrt(1 - y * y);
    const theta = goldenAngle * i;
    out.push([Math.cos(theta) * r, y, Math.sin(theta) * r]);
  }
  return out;
})();

function golfColor(dx: number, dy: number, dz: number, out: THREE.Color): void {
  out.copy(C.golfBody);

  // Find the nearest dimple center on the unit sphere.
  let bestDot = -2;
  for (const c of GOLF_DIMPLE_CENTERS) {
    const d = c[0] * dx + c[1] * dy + c[2] * dz;
    if (d > bestDot) bestDot = d;
  }
  const ang = Math.acos(Math.min(1, Math.max(-1, bestDot)));

  // Dimple shading: a darker "cup" inside each dimple's angular disk
  // with a slightly brighter rim where neighbouring dimples meet.
  // The actual depth is in the lighting, but this fakes the dimple
  // shadow well enough that the eye reads the pattern as
  // hemispherical pits.
  if (ang < GOLF_DIMPLE_R) {
    const t = ang / GOLF_DIMPLE_R;
    // Bowl: 1 at center, 0 at rim.
    const bowl = 1 - t * t;
    // Rim brightness band near the boundary.
    const rim = Math.exp(-Math.pow(t - 0.85, 2) * 26);
    out.multiplyScalar(1 - 0.18 * bowl + 0.04 * rim);
  }
}

// ---------- volleyball ------------------------------------------------------

const VOLLEYBALL_RADIUS = 0.93;
const VOLLEYBALL_PANELS = 6;
/**
 * Six "lune" panels arranged around the +y / −y poles, alternating
 * white / blue / white / yellow / white / blue. This is a stylized
 * tribute to the classic Mikasa V200W tri-color pattern — six panels
 * meeting at two opposite poles, each panel a 60°-wide stripe of
 * longitude. We paint a darker stitched seam at every panel boundary.
 */
const VOLLEYBALL_BAND_COLORS: THREE.Color[] = [
  C.volleyballWhite,
  C.volleyballBlue,
  C.volleyballWhite,
  C.volleyballYellow,
  C.volleyballWhite,
  C.volleyballBlue,
];

function volleyballColor(
  dx: number,
  _dy: number,
  dz: number,
  out: THREE.Color,
): void {
  // Azimuth around y, normalized to 0..VOLLEYBALL_PANELS.
  const phi = Math.atan2(dz, dx);
  const bandPos = ((phi + Math.PI) / (2 * Math.PI)) * VOLLEYBALL_PANELS;
  const bandIdx = Math.floor(bandPos);
  const bandFrac = bandPos - bandIdx;
  out.copy(VOLLEYBALL_BAND_COLORS[bandIdx % VOLLEYBALL_PANELS]);

  // Soft stitched seam at each panel boundary.
  const distToBoundary = Math.min(bandFrac, 1 - bandFrac);
  const seamFade = Math.exp(-(distToBoundary * distToBoundary) / 0.0012);
  out.multiplyScalar(1 - 0.28 * seamFade);
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
    key: "cricket",
    name: "Cricket Ball",
    surfaceDist: makeSphereDist(CRICKET_RADIUS),
    colorAt: cricketColor,
    rimColor: "#ff8a7a",
    spinAxis: "y",
    spinSpeed: 0.7,
    // Tightly polished leather: lower roughness than the baseball, a
    // hint of metalness for the deep-red sheen real cricket balls
    // pick up after a few overs.
    roughness: 0.32,
    metalness: 0.08,
    envMapIntensity: 1.05,
  },
  {
    key: "tennis",
    name: "Tennis Ball",
    surfaceDist: makeSphereDist(TENNIS_RADIUS),
    colorAt: tennisColor,
    rimColor: "#e8ff8a",
    spinAxis: "y",
    spinSpeed: 0.6,
    // Felt is matte — high roughness, no metalness — so the
    // rim-light reads as a soft halo rather than a sharp specular.
    roughness: 0.95,
    metalness: 0,
    envMapIntensity: 0.55,
  },
  {
    key: "golf",
    name: "Golf Ball",
    surfaceDist: makeSphereDist(GOLF_RADIUS),
    colorAt: golfColor,
    rimColor: "#f0f4ff",
    spinAxis: "y",
    spinSpeed: 0.85,
    // Slick injection-molded plastic over a hard core — low roughness
    // for sharp specular highlights that move across the dimple
    // pattern as the camera orbits.
    roughness: 0.28,
    metalness: 0.03,
    envMapIntensity: 1.1,
  },
  {
    key: "volleyball",
    name: "Volleyball",
    surfaceDist: makeSphereDist(VOLLEYBALL_RADIUS),
    colorAt: volleyballColor,
    rimColor: "#ffd56a",
    spinAxis: "y",
    spinSpeed: 0.55,
    // Synthetic leather — between matte and glossy.
    roughness: 0.55,
    metalness: 0.02,
    envMapIntensity: 0.9,
  },
];
