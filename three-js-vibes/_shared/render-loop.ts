/**
 * Shared render-loop primitives for the playground vibes.
 *
 * Two concerns, both small and standalone:
 *
 *   1. `attachRenderVisibility(mount)` — returns a mutable `{ current: boolean }`
 *      ref that flips between true/false based on whether the mount element is
 *      intersecting the viewport AND the tab is currently visible. Each vibe's
 *      `requestAnimationFrame` tick can early-return when `current === false`,
 *      so a vibe scrolled out of view (or in a backgrounded tab) stops paying
 *      for `renderer.render(...)`, mixer updates, particle math, etc.
 *
 *      We deliberately do NOT cancel the RAF itself — keeping the callback
 *      registered lets the loop resume in the same frame the vibe comes back
 *      into view, with no extra plumbing in each vibe's effect cleanup. The
 *      RAF callback alone is nearly free; the cost the user feels is the
 *      render + simulation work behind it.
 *
 *   2. `createFpsThrottle(targetFps)` — tiny accumulator that returns
 *      `shouldRender(now)`. Decorative vibes (disco dancer, sport-ball
 *      morpher, wizard PC) read fine at 30fps and halving the render cadence
 *      cuts their fragment-shader cost in half. Physics-driven vibes (sport
 *      arena's WebGPU SSGI ball pool) want the full 60fps.
 *
 * Both helpers are framework-agnostic — they don't import React or three —
 * so they can be used inside any vibe's existing mount effect without
 * disturbing the lifecycle pattern.
 */

export interface RenderVisibility {
  /** Mutable boolean ref the vibe checks at the top of its tick loop. */
  readonly visibleRef: { current: boolean };
  /** Call from effect cleanup. Disconnects the observers and document listener. */
  readonly dispose: () => void;
}

/**
 * Wire up viewport + tab visibility for a single mount element.
 *
 * `rootMargin` defaults to `"200px"` so vibes that are just barely off-screen
 * stay rendering — avoids flicker when the user scrolls back and forth across
 * the vibe boundary. Make it `"0px"` for stricter pause behavior.
 */
export function attachRenderVisibility(
  mount: Element,
  rootMargin = "200px",
): RenderVisibility {
  const visibleRef = { current: true };
  let intersecting = true;
  let documentVisible =
    typeof document === "undefined" ? true : !document.hidden;

  const recompute = () => {
    visibleRef.current = intersecting && documentVisible;
  };

  recompute();

  let io: IntersectionObserver | null = null;
  if (typeof IntersectionObserver !== "undefined") {
    io = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          intersecting = entry.isIntersecting;
        }
        recompute();
      },
      { rootMargin },
    );
    io.observe(mount);
  }

  const onDocumentVisibility = () => {
    documentVisible = !document.hidden;
    recompute();
  };

  if (typeof document !== "undefined") {
    document.addEventListener("visibilitychange", onDocumentVisibility);
  }

  return {
    visibleRef,
    dispose: () => {
      io?.disconnect();
      if (typeof document !== "undefined") {
        document.removeEventListener("visibilitychange", onDocumentVisibility);
      }
    },
  };
}

export interface FpsThrottle {
  /**
   * Returns true when enough wall-clock time has elapsed to render the next
   * frame at the configured cadence. Vibes call this once per tick and skip
   * the render work when it returns false.
   *
   * The supplied `now` is whatever clock the vibe is already using
   * (`performance.now()` or a three.js `Clock` time) — caller decides, as
   * long as it's monotonic milliseconds.
   */
  readonly shouldRender: (now: number) => boolean;
}

/**
 * Create an FPS gate. Pass `Infinity` (or just don't call this) to render
 * every frame.
 */
export function createFpsThrottle(targetFps: number): FpsThrottle {
  if (!Number.isFinite(targetFps) || targetFps <= 0) {
    return { shouldRender: () => true };
  }
  const interval = 1000 / targetFps;
  let last = -Infinity;
  return {
    shouldRender(now: number) {
      if (now - last >= interval) {
        last = now;
        return true;
      }
      return false;
    },
  };
}
