import type { CrtScreen } from "./crt-screen";
import type { TerminalBuffer } from "./terminal-buffer";
import {
  AUTO_DEMO,
  OPENING,
  PROMPT,
  resolveCommand,
} from "./zork-script";

/**
 * Drives the hybrid Zork loop on the CRT.
 *
 * Phases:
 *   - `boot`    — emissive ramps 0 -> 1 over 600 ms while the screen is blank.
 *   - `opening` — types each line of {@link OPENING} into the terminal.
 *   - `demo`    — for each {@link AUTO_DEMO} step, types `> {command}`,
 *                 then prints the response.
 *   - `prompt`  — opens an empty `> ` line, blinks the caret, awaits user
 *                 input. Idle resets to `opening` after `IDLE_RESUME_MS`.
 *
 * The user's keyboard input is fed via {@link onUserChar} / {@link onUserBackspace} /
 * {@link onUserCommit}. Those wake the prompt phase and reset the idle
 * timer, but the controller itself doesn't open a `<input>` — that's
 * the {@link InputController}'s job.
 *
 * `setReducedMotion(true)` collapses per-char typing into per-line
 * paints and cancels timers; the loop still runs but as a slideshow,
 * not an animation. Lines wait `LINE_PAUSE_REDUCED` between paints
 * so the eye can keep up.
 */

export const IDLE_RESUME_MS = 12_000;

const BOOT_RAMP_MS = 600;
const CHAR_MS_BASE = 28;
const CHAR_MS_JITTER = 18;
const LINE_PAUSE_MS = 220;
const LINE_PAUSE_REDUCED_MS = 600;
const PRE_DEMO_PAUSE_MS = 900;
const POST_DEMO_PAUSE_MS = 1400;

type Phase = "boot" | "opening" | "demo" | "prompt" | "echo" | "response";

export interface ShowController {
  start(): void;
  /**
   * Append one character from the user's keyboard to the pending
   * prompt line. If we're not in `prompt` yet (e.g. the user hammered
   * a key during the auto-loop), we abort the autoplay and snap to a
   * fresh prompt before accepting the input.
   */
  onUserChar(ch: string): void;
  onUserBackspace(): void;
  /** User pressed Enter — commit and respond. */
  onUserCommit(): void;
  /** Programmatic check used by the input controller for cursor state. */
  isAcceptingInput(): boolean;
  setReducedMotion(reduced: boolean): void;
  dispose(): void;
}

export interface ShowControllerOptions {
  buffer: TerminalBuffer;
  screen: CrtScreen;
}

export function createShowController(opts: ShowControllerOptions): ShowController {
  const { buffer, screen } = opts;

  let reduced = false;
  let disposed = false;
  let phase: Phase = "boot";
  let idleTimer: ReturnType<typeof setTimeout> | null = null;
  const timeouts = new Set<ReturnType<typeof setTimeout>>();

  function schedule(fn: () => void, ms: number) {
    if (disposed) return;
    const id = setTimeout(() => {
      timeouts.delete(id);
      if (disposed) return;
      fn();
    }, ms);
    timeouts.add(id);
  }

  function clearAllTimers() {
    for (const id of timeouts) clearTimeout(id);
    timeouts.clear();
    if (idleTimer) {
      clearTimeout(idleTimer);
      idleTimer = null;
    }
  }

  function bootRamp(then: () => void) {
    phase = "boot";
    const start = performance.now();
    function frame() {
      if (disposed) return;
      const t = (performance.now() - start) / BOOT_RAMP_MS;
      const v = Math.min(1, Math.max(0, t));
      // Ease-out so the screen warms up the way a CRT does.
      const eased = 1 - (1 - v) * (1 - v);
      screen.setEmissive(eased);
      if (v < 1) requestAnimationFrame(frame);
      else then();
    }
    requestAnimationFrame(frame);
  }

  function typeLine(line: string, prefix: string, onDone: () => void) {
    if (reduced || line.length === 0) {
      buffer.appendLine(prefix + line);
      schedule(onDone, reduced ? LINE_PAUSE_REDUCED_MS : LINE_PAUSE_MS);
      return;
    }

    buffer.beginPendingLine(prefix);
    buffer.setBlinkEnabled(false);
    buffer.setCaretVisible(true);

    let i = 0;
    function step() {
      if (disposed) return;
      if (i >= line.length) {
        buffer.commitPending();
        buffer.beginPendingLine(""); // reset prefix so subsequent lines render plain
        buffer.setBlinkEnabled(true);
        schedule(onDone, LINE_PAUSE_MS);
        return;
      }
      buffer.appendToPendingChar(line[i]);
      i += 1;
      schedule(step, CHAR_MS_BASE + Math.random() * CHAR_MS_JITTER);
    }
    schedule(step, CHAR_MS_BASE);
  }

  function printLines(
    lines: readonly string[],
    prefix: string,
    onDone: () => void,
  ) {
    let i = 0;
    function next() {
      if (i >= lines.length) {
        onDone();
        return;
      }
      const line = lines[i];
      i += 1;
      // Only the first line of a multi-line block carries the prompt
      // prefix (that's what makes it look like a typed command);
      // subsequent lines render plain.
      typeLine(line, i === 1 ? prefix : "", next);
    }
    next();
  }

  function runOpening(onDone: () => void) {
    phase = "opening";
    buffer.clear();
    buffer.beginPendingLine("");
    printLines(OPENING, "", onDone);
  }

  function runDemo(onDone: () => void) {
    phase = "demo";
    let stepIdx = 0;
    function nextStep() {
      if (stepIdx >= AUTO_DEMO.length) {
        onDone();
        return;
      }
      const step = AUTO_DEMO[stepIdx];
      stepIdx += 1;
      // Type the command as though the user is at the keyboard, then
      // print its response.
      typeLine(step.command, PROMPT + " ", () => {
        printLines(step.response, "", () => {
          schedule(nextStep, LINE_PAUSE_MS);
        });
      });
    }
    schedule(nextStep, PRE_DEMO_PAUSE_MS);
  }

  function openPrompt() {
    phase = "prompt";
    buffer.beginPendingLine(PROMPT + " ");
    buffer.setBlinkEnabled(true);
    buffer.setCaretVisible(true);
    armIdleTimer();
  }

  function armIdleTimer() {
    if (idleTimer) clearTimeout(idleTimer);
    idleTimer = setTimeout(() => {
      idleTimer = null;
      if (disposed || phase !== "prompt") return;
      // Loop back to the opening for the next cinematic pass.
      restartLoop();
    }, IDLE_RESUME_MS);
  }

  function resetIdleTimer() {
    if (phase === "prompt") armIdleTimer();
  }

  function restartLoop() {
    clearAllTimers();
    runOpening(() => runDemo(() => schedule(openPrompt, POST_DEMO_PAUSE_MS)));
  }

  function abortAutoplayIntoPrompt() {
    // The user typed a key during the autoplay — snap forward to the
    // prompt so input doesn't get dropped or interleaved with auto-typed
    // text.
    clearAllTimers();
    buffer.setBlinkEnabled(true);
    buffer.beginPendingLine(PROMPT + " ");
    phase = "prompt";
    armIdleTimer();
  }

  return {
    start() {
      bootRamp(() => {
        runOpening(() =>
          runDemo(() => schedule(openPrompt, POST_DEMO_PAUSE_MS)),
        );
      });
    },
    onUserChar(ch: string) {
      if (disposed) return;
      if (phase !== "prompt") {
        abortAutoplayIntoPrompt();
      }
      buffer.appendToPendingChar(ch);
      buffer.setCaretVisible(true);
      resetIdleTimer();
    },
    onUserBackspace() {
      if (disposed) return;
      if (phase !== "prompt") {
        abortAutoplayIntoPrompt();
        return;
      }
      buffer.backspacePending();
      resetIdleTimer();
    },
    onUserCommit() {
      if (disposed) return;
      if (phase !== "prompt") {
        abortAutoplayIntoPrompt();
        return;
      }
      const input = buffer.pendingInput();
      buffer.commitPending();
      const response = resolveCommand(input);
      phase = "response";
      buffer.beginPendingLine("");
      buffer.setBlinkEnabled(false);
      buffer.setCaretVisible(false);
      printLines(response, "", () => {
        if (disposed) return;
        openPrompt();
      });
    },
    isAcceptingInput() {
      return phase === "prompt";
    },
    setReducedMotion(v: boolean) {
      reduced = v;
    },
    dispose() {
      disposed = true;
      clearAllTimers();
    },
  };
}
