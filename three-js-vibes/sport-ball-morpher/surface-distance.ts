/**
 * Per-sport "ray from origin" surface distance functions.
 *
 * Given a unit direction `(dx, dy, dz)` in object-local space, each function
 * returns the distance `t` from the origin to the sport's surface along that
 * ray. We use these to drive a true vertex-level silhouette morph: every
 * vertex of every sport mesh is precomputed into a `(direction, restDist)`
 * pair, and during a morph the shader interpolates each vertex's distance
 * between `restDist` (its own sport) and `targetDist = surfaceDist(otherSport, direction)`.
 *
 * Both meshes in a morph use the SAME pair of surface distance functions to
 * compute their target distances, so when their `t` parameters are stepped
 * in lockstep both meshes produce the same silhouette at every moment of
 * the morph — that's what makes the transition read as one shape molding
 * into the next instead of two shapes crossfading.
 *
 * All shapes are defined in a normalized orientation (no group rotations on
 * the meshes). Mesh builders bake any aesthetic rotations directly into the
 * geometry so every silhouette is queried in the same world frame.
 */
export type SurfaceDistanceFn = (
  dx: number,
  dy: number,
  dz: number,
) => number;

/** Sphere centered at origin: distance is just the radius for any direction. */
export function makeSphereDist(radius: number): SurfaceDistanceFn {
  return () => radius;
}

/**
 * Football — prolate spheroid (sphere of radius `baseRadius` stretched along
 * +z by `zStretch`) with a quartic taper at the tips. Same shape model the
 * `buildFootball` mesh deforms its sphere into; the iterative solve here
 * inverts that deformation to produce the matching ray-from-origin distance.
 *
 * Surface model: a sphere vertex at `(x, y, z)` with `x² + y² + z² = a²`
 * (where `a = baseRadius`) is mapped to `(x · tipF, y · tipF, z · zStretch)`
 * where `tipF = 1 - (|z|/a)^4 · tipFalloff`. To find the distance `t` along
 * direction `d` such that `d · t` lies on the surface, we solve:
 *
 *   x = d.x · t / tipF
 *   y = d.y · t / tipF
 *   z = d.z · t / zStretch
 *   x² + y² + z² = a²
 *
 * `tipF` itself depends on `z`, which depends on `t`, so we fixed-point
 * iterate: start with the pure-ellipsoid solution (tipF = 1) and refine
 * until `t` settles. Converges in 2-3 iterations for typical directions.
 */
export function makeFootballDist(
  baseRadius: number,
  zStretch: number,
  tipFalloff: number,
): SurfaceDistanceFn {
  const a = baseRadius;
  const b = baseRadius * zStretch;
  return (dx, dy, dz) => {
    const xy2 = dx * dx + dy * dy;
    const z2 = dz * dz;
    let t = 1 / Math.sqrt(xy2 / (a * a) + z2 / (b * b));
    for (let i = 0; i < 8; i++) {
      const z = (dz * t) / zStretch;
      const tipF = 1 - Math.pow(Math.abs(z) / a, 4) * tipFalloff;
      const tNew = a / Math.sqrt(xy2 / (tipF * tipF) + z2 / (zStretch * zStretch));
      if (Math.abs(tNew - t) < 1e-6) {
        t = tNew;
        break;
      }
      t = tNew;
    }
    return t;
  };
}

/**
 * Bat — `LatheGeometry` swept around the Y axis from a 10-point profile
 * `[(r₀, y₀), … (r₉, y₉)]`. The bat is star-shaped from the origin (the
 * origin sits comfortably inside the bat's mid-section), so any ray from
 * the origin hits the lathe surface exactly once.
 *
 * For each profile segment `i → i+1`, the surface inside that band is
 * `ρ = r(y) = rᵢ + (rᵢ₊₁ - rᵢ) · (y - yᵢ) / (yᵢ₊₁ - yᵢ)`. Combined with the
 * ray equation `(ρ_actual, y_actual) = (ρ_xz · t, dy · t)`, we get a linear
 * equation in `t`:
 *
 *   ρ_xz · t · (yᵢ₊₁ - yᵢ) = rᵢ · (yᵢ₊₁ - yᵢ) + (rᵢ₊₁ - rᵢ) · (dy · t - yᵢ)
 *
 * Solving for `t` gives a closed-form expression per segment; we walk the
 * profile and return the first segment whose `y_at_t` falls inside that
 * segment's band.
 */
export function makeLatheDist(profile: [number, number][]): SurfaceDistanceFn {
  return (dx, dy, dz) => {
    const rho = Math.sqrt(dx * dx + dz * dz);
    if (rho < 1e-6) {
      // Pure y-axis ray — hits the lathe at the bat's tip / knob extreme.
      const yEnd =
        dy > 0
          ? profile[profile.length - 1][1]
          : profile[0][1];
      return Math.abs(yEnd / Math.max(Math.abs(dy), 1e-6));
    }
    if (Math.abs(dy) < 1e-6) {
      // Pure xz-plane ray — hits at y = 0; look up the radius there.
      const r0 = lookupLatheRadius(profile, 0);
      return r0 / rho;
    }
    for (let i = 0; i < profile.length - 1; i++) {
      const [r0, y0] = profile[i];
      const [r1, y1] = profile[i + 1];
      const dyp = y1 - y0;
      const drp = r1 - r0;
      const denom = rho * dyp - drp * dy;
      if (Math.abs(denom) < 1e-9) continue;
      const t = (r0 * dyp - drp * y0) / denom;
      if (t <= 0) continue;
      const yAt = dy * t;
      const yMin = Math.min(y0, y1);
      const yMax = Math.max(y0, y1);
      if (yAt >= yMin - 1e-5 && yAt <= yMax + 1e-5) return t;
    }
    // Fallback (should not happen for a well-behaved star-shaped lathe):
    // hit one of the y-axis caps.
    const yEnd =
      dy > 0 ? profile[profile.length - 1][1] : profile[0][1];
    return Math.abs(yEnd / dy);
  };
}

function lookupLatheRadius(profile: [number, number][], y: number): number {
  for (let i = 0; i < profile.length - 1; i++) {
    const [r0, y0] = profile[i];
    const [r1, y1] = profile[i + 1];
    if (y >= Math.min(y0, y1) && y <= Math.max(y0, y1)) {
      const u = (y - y0) / (y1 - y0);
      return r0 + (r1 - r0) * u;
    }
  }
  return 0;
}

/**
 * Capped cylinder along an axis. Rays from origin hit one of:
 *   - the cylindrical side (tangent to a cylinder of radius `R`),
 *   - one of the two flat caps at axis position `±halfHeight`.
 *
 * The first surface hit is whichever gives the smaller positive `t`. This
 * makes the puck's silhouette correctly transition from "round face" near
 * the cap-axis directions to "flat rim" near the side-axis directions.
 */
export function makeCylinderDist(
  radius: number,
  halfHeight: number,
  axis: "x" | "y" | "z",
): SurfaceDistanceFn {
  return (dx, dy, dz) => {
    let primary: number, c1: number, c2: number;
    if (axis === "x") {
      primary = dx;
      c1 = dy;
      c2 = dz;
    } else if (axis === "y") {
      primary = dy;
      c1 = dx;
      c2 = dz;
    } else {
      primary = dz;
      c1 = dx;
      c2 = dy;
    }
    const rho = Math.sqrt(c1 * c1 + c2 * c2);
    const tSide = rho > 1e-6 ? radius / rho : Infinity;
    const tCap = Math.abs(primary) > 1e-6 ? halfHeight / Math.abs(primary) : Infinity;
    return Math.min(tSide, tCap);
  };
}
