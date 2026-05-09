import gsap from "gsap";

import type { ParticleSystem } from "./particle-system";
import { sampleSvg, type Sample } from "./svg-sampler";

export interface MorphFrame {
  /** Absolute or root-relative URL of the SVG to morph into. */
  url: string;
  /** Display name shown in the overlay caption. */
  name: string;
  /** Sport blurb shown under the name. */
  caption: string;
  /** Hex color for the particle tint. */
  color: string;
}

export interface MorphController {
  /** Promise that resolves once all frames are sampled and ready. */
  ready: Promise<void>;
  /** Called every animation frame from the host loop. */
  update(now: number): void;
  /** Manually advance to the next frame (e.g., on click). */
  next(): void;
  /** Index of the frame currently displayed. */
  getCurrentIndex(): number;
  /** Subscribe to frame-change events (fires when the new frame "lands"). */
  onFrameSettled(cb: (index: number, frame: MorphFrame) => void): () => void;
  setReducedMotion(reduced: boolean): void;
  dispose(): void;
}

export interface MorphControllerOptions {
  system: ParticleSystem;
  frames: MorphFrame[];
  /** World-space scale for the silhouette ([-1,1] sample → [-scale,scale]). */
  scale?: number;
  /** Seconds the logo holds before morphing to the next. */
  holdSeconds?: number;
  /** Seconds for the morph itself (excluding stagger). */
  morphSeconds?: number;
  /** Initial reduced-motion state. */
  reducedMotion?: boolean;
}

const TMP = { r: 0, g: 0, b: 0 };

function hexToRgb(hex: string, out: typeof TMP) {
  const h = hex.replace("#", "");
  const n = parseInt(
    h.length === 3
      ? h.split("").map((c) => c + c).join("")
      : h,
    16,
  );
  out.r = ((n >> 16) & 255) / 255;
  out.g = ((n >> 8) & 255) / 255;
  out.b = (n & 255) / 255;
}

export function createMorphController(
  opts: MorphControllerOptions,
): MorphController {
  const {
    system,
    frames,
    scale = 1.6,
    holdSeconds = 3.2,
    morphSeconds = 1.6,
    reducedMotion = false,
  } = opts;

  if (frames.length === 0) {
    throw new Error("logo-forge: at least one frame is required");
  }

  let reduced = reducedMotion;
  let currentIndex = 0;
  let disposed = false;
  const frameSamples: Sample[][] = new Array(frames.length);
  const subscribers = new Set<(index: number, frame: MorphFrame) => void>();
  const tweens = new Set<gsap.core.Tween>();
  let scheduledNext: gsap.core.Tween | null = null;

  const ready = (async () => {
    // Preload everything in parallel so the first paint is instant.
    const results = await Promise.all(
      frames.map((f) => sampleSvg(f.url, system.count)),
    );
    if (disposed) return;
    for (let i = 0; i < results.length; i++) frameSamples[i] = results[i];
    applyFrame(0, /*animate=*/ !reduced);
  })();

  function writeTargets(index: number) {
    const samples = frameSamples[index];
    if (!samples) return;
    const { targets } = system;
    for (let i = 0; i < system.count; i++) {
      const i3 = i * 3;
      const s = samples[i];
      targets[i3] = s.x * scale;
      targets[i3 + 1] = s.y * scale;
      // Slight randomized depth so the silhouette feels volumetric, not flat.
      targets[i3 + 2] = (Math.random() - 0.5) * 0.35;
    }
  }

  /**
   * For each particle, compute a swirled Bezier midpoint between its current
   * origin and the new target. The midpoint is the geometric midpoint rotated
   * tangentially around the canvas center and pushed outward, so the morph
   * arcs through a vortex instead of straight-lining. Add Z jitter so the
   * vortex has volume.
   */
  function writeMidpoints() {
    const { origins, targets, midpoints } = system;
    for (let i = 0; i < system.count; i++) {
      const i3 = i * 3;
      const ox = origins[i3];
      const oy = origins[i3 + 1];
      const tx = targets[i3];
      const ty = targets[i3 + 1];
      const mx = (ox + tx) * 0.5;
      const my = (oy + ty) * 0.5;
      // Rotate the midpoint around the origin by ~quarter-turn and push it
      // outward. The base radius keeps the swirl visible even when origin and
      // target are close together (small `m` magnitude).
      const baseAngle = Math.atan2(my, mx);
      const swirl = Math.PI * 0.45 + (Math.random() - 0.5) * 0.4;
      const radius = Math.hypot(mx, my) * 1.6 + 0.7 + Math.random() * 0.3;
      const angle = baseAngle + swirl;
      midpoints[i3] = Math.cos(angle) * radius;
      midpoints[i3 + 1] = Math.sin(angle) * radius;
      midpoints[i3 + 2] = (Math.random() - 0.5) * 1.2;
    }
  }

  function writeColorTargets(index: number) {
    hexToRgb(frames[index].color, TMP);
    const { colorTargets } = system;
    for (let i = 0; i < system.count; i++) {
      const i3 = i * 3;
      // Per-particle hue jitter (small lightness variance) so the cloud
      // reads as glowing dust rather than a flat color sheet.
      const j = 0.85 + Math.random() * 0.3;
      colorTargets[i3] = Math.min(TMP.r * j, 1);
      colorTargets[i3 + 1] = Math.min(TMP.g * j, 1);
      colorTargets[i3 + 2] = Math.min(TMP.b * j, 1);
    }
  }

  function applyFrame(index: number, animate: boolean) {
    if (disposed) return;
    currentIndex = index;
    writeTargets(index);
    writeColorTargets(index);

    // Snapshot current positions as the tween "from" so the morph interpolates
    // smoothly even mid-flight, then derive the swirl midpoints from
    // origins → targets.
    system.origins.set(system.positions);
    writeMidpoints();

    if (!animate) {
      system.positions.set(system.targets);
      system.colors.set(system.colorTargets);
      system.flush();
      notify(index);
      schedule();
      return;
    }

    // GSAP-driven progress 0→1 with stagger via per-particle delay (we use a
    // single-value tween rather than 3000 individual tweens to keep GC happy).
    const state = { p: 0 };
    const tween = gsap.to(state, {
      p: 1,
      duration: morphSeconds,
      ease: "power2.inOut",
      onUpdate: () => {
        const p = state.p;
        const { positions, origins, midpoints, targets, colors, colorTargets } =
          system;
        for (let i = 0; i < system.count; i++) {
          const i3 = i * 3;
          // Stagger: each particle starts at a different point along [0, 1].
          // We squish their personal progress into [0, 1] via a small offset.
          const offset = (i % 17) * 0.012;
          const local = Math.min(Math.max(p * 1.18 - offset, 0), 1);
          const ease = local * local * (3 - 2 * local); // smoothstep
          // Quadratic Bezier through (origin → midpoint → target). Particles
          // arc through the swirled midpoint instead of straight-lining,
          // giving the morph its vortex character.
          const it = 1 - ease;
          const a = it * it;
          const b = 2 * it * ease;
          const c = ease * ease;
          positions[i3] =
            a * origins[i3] + b * midpoints[i3] + c * targets[i3];
          positions[i3 + 1] =
            a * origins[i3 + 1] +
            b * midpoints[i3 + 1] +
            c * targets[i3 + 1];
          positions[i3 + 2] =
            a * origins[i3 + 2] +
            b * midpoints[i3 + 2] +
            c * targets[i3 + 2];
          colors[i3] = colors[i3] + (colorTargets[i3] - colors[i3]) * 0.06;
          colors[i3 + 1] =
            colors[i3 + 1] + (colorTargets[i3 + 1] - colors[i3 + 1]) * 0.06;
          colors[i3 + 2] =
            colors[i3 + 2] + (colorTargets[i3 + 2] - colors[i3 + 2]) * 0.06;
        }
        system.flush();
      },
      onComplete: () => {
        tweens.delete(tween);
        notify(index);
        schedule();
      },
    });
    tweens.add(tween);
  }

  function notify(index: number) {
    subscribers.forEach((cb) => cb(index, frames[index]));
  }

  function schedule() {
    if (reduced) return;
    scheduledNext?.kill();
    scheduledNext = gsap.delayedCall(holdSeconds, () => {
      if (disposed || reduced) return;
      const next = (currentIndex + 1) % frames.length;
      applyFrame(next, true);
    }) as unknown as gsap.core.Tween;
  }

  function update(now: number) {
    if (disposed || !frameSamples[currentIndex]) return;
    // Idle drift: small per-particle wobble around the target so the held
    // logo "breathes." Skip while a morph is mid-tween (positions are being
    // written by the tween's onUpdate).
    if (tweens.size > 0) return;
    if (reduced) return;

    const t = now * 0.001;
    const { positions, targets, phases } = system;
    for (let i = 0; i < system.count; i++) {
      const i3 = i * 3;
      const ph = phases[i];
      const wobble = Math.sin(t * 1.4 + ph) * 0.012;
      const wobble2 = Math.cos(t * 1.1 + ph * 1.3) * 0.012;
      positions[i3] = targets[i3] + wobble;
      positions[i3 + 1] = targets[i3 + 1] + wobble2;
      positions[i3 + 2] =
        targets[i3 + 2] + Math.sin(t * 0.8 + ph) * 0.04;
    }
    system.flush();
  }

  return {
    ready,
    update,
    next() {
      if (disposed) return;
      const ni = (currentIndex + 1) % frames.length;
      applyFrame(ni, !reduced);
    },
    getCurrentIndex() {
      return currentIndex;
    },
    onFrameSettled(cb) {
      subscribers.add(cb);
      return () => subscribers.delete(cb);
    },
    setReducedMotion(next) {
      reduced = next;
      if (reduced) {
        scheduledNext?.kill();
        scheduledNext = null;
      } else {
        schedule();
      }
    },
    dispose() {
      disposed = true;
      tweens.forEach((t) => t.kill());
      tweens.clear();
      scheduledNext?.kill();
      scheduledNext = null;
      subscribers.clear();
    },
  };
}
