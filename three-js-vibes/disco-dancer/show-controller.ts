import type { Confetti } from "./confetti";
import type { DiscoBall } from "./disco-ball";
import type { ClubLights } from "./club-lights";

/**
 * Timeline for the disco dancer:
 *
 * ```
 * t=0       mounted; samba already playing; ball hidden, lights off, no confetti
 * t=3000    burst confetti #1
 * t=8000    start ball descent (lerp y over 2s)
 * t=10000   ball at rest, spinning permanently; ramp club lights to full
 * t=12000+  steady state. Schedule confetti burst every 25s forever.
 * ```
 *
 * The controller is a small state machine over a single tick-time clock.
 * No `setTimeout`s — `update(now)` is called every frame and it advances
 * itself, so reduced-motion can pause it cleanly with no timers in flight.
 */

const CONFETTI_FIRST_AT_MS = 3000;
const BALL_DESCENT_START_MS = 8000;
const BALL_DESCENT_DURATION_MS = 2000;
const LIGHTS_ON_AT_MS = 10000;
const STEADY_STATE_AT_MS = 12000;
const CONFETTI_REPEAT_INTERVAL_MS = 25000;

export interface ShowController {
  /** Drive from the render loop. `now` is `performance.now()`. */
  update: (now: number) => void;
  setReducedMotion: (reduced: boolean) => void;
  dispose: () => void;
}

export interface ShowControllerOptions {
  confetti: Confetti;
  ball: DiscoBall;
  lights: ClubLights;
}

export function createShowController(opts: ShowControllerOptions): ShowController {
  const { confetti, ball, lights } = opts;

  // Set baseline state so a reduced-motion mount is visually consistent: no
  // confetti, lights off, ball just barely peeking from above (height=0).
  ball.setHeight(0);

  let startedAt: number | null = null;
  let didFirstConfetti = false;
  let didStartDescent = false;
  let didFinishDescent = false;
  let didLightsOn = false;
  let nextRepeatBurstAt: number | null = null;
  let reduced = false;
  let disposed = false;

  /**
   * When reduced-motion flips on we collapse to the steady-state visuals
   * with zero animation — ball at rest, lights on, no confetti. This makes
   * the page render the "final picture" rather than freezing mid-show.
   */
  function snapToSteadyState() {
    ball.setHeight(1);
    if (!didLightsOn) {
      lights.enable();
      didLightsOn = true;
    }
    nextRepeatBurstAt = null;
  }

  function update(now: number) {
    if (disposed) return;
    if (startedAt === null) startedAt = now;
    const t = now - startedAt;

    if (reduced) return;

    // Phase 1: first confetti burst.
    if (!didFirstConfetti && t >= CONFETTI_FIRST_AT_MS) {
      confetti.burst();
      didFirstConfetti = true;
    }

    // Phase 2: ball descent.
    if (!didStartDescent && t >= BALL_DESCENT_START_MS) {
      didStartDescent = true;
    }
    if (didStartDescent && !didFinishDescent) {
      const descentT = (t - BALL_DESCENT_START_MS) / BALL_DESCENT_DURATION_MS;
      ball.setHeight(descentT);
      if (descentT >= 1) {
        ball.setHeight(1);
        didFinishDescent = true;
      }
    }

    // Phase 3: lights kick on.
    if (!didLightsOn && t >= LIGHTS_ON_AT_MS) {
      lights.enable();
      didLightsOn = true;
    }

    // Phase 4 (steady state): repeating confetti bursts every 25s.
    if (t >= STEADY_STATE_AT_MS) {
      if (nextRepeatBurstAt === null) {
        nextRepeatBurstAt = now + CONFETTI_REPEAT_INTERVAL_MS;
      } else if (now >= nextRepeatBurstAt) {
        confetti.burst();
        nextRepeatBurstAt = now + CONFETTI_REPEAT_INTERVAL_MS;
      }
    }
  }

  function setReducedMotion(value: boolean) {
    reduced = value;
    if (reduced) snapToSteadyState();
  }

  function dispose() {
    disposed = true;
  }

  return { update, setReducedMotion, dispose };
}
