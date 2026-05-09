import * as THREE from "three";

import { PROMPT } from "./zork-script";

/**
 * Amber-phosphor CRT terminal backed by a {@link THREE.CanvasTexture}.
 *
 * The buffer holds an array of {@link string} lines plus a single
 * "pending" line where typing happens character-by-character. Lines
 * older than {@link MAX_LINES} are dropped from the top so the canvas
 * scrolls naturally.
 *
 * The redraw is intentionally cheap — clear, paint background, paint
 * each visible line at a fixed monospace step, then mark the texture
 * dirty. We only mark it dirty on actual content / cursor change, so
 * the GPU upload stays out of the path on idle frames.
 *
 * Faint per-pixel scanlines are drawn into the source canvas so the
 * effect survives the bulged/curved sample in the screen shader (the
 * shader's own scanline term is very subtle and rides on top of these
 * for a stronger CRT read).
 */

const CANVAS_WIDTH = 1024;
const CANVAS_HEIGHT = 768;
const FONT_SIZE = 22;
const LINE_HEIGHT = 28;
const PADDING_X = 36;
const PADDING_TOP = 28;
const MAX_LINES = 22;

const PHOSPHOR = "#ffb14a";
const PHOSPHOR_DIM = "rgba(255, 177, 74, 0.55)";
const BG = "#1a0e02";
const SCANLINE = "rgba(0, 0, 0, 0.18)";

export interface TerminalBuffer {
  readonly texture: THREE.CanvasTexture;
  /** Append one or more whole lines (no per-char typing). */
  appendLine(text: string): void;
  /** Clear the pending line and start typing into it. */
  beginPendingLine(prefix?: string): void;
  /**
   * Append a single character to the pending line. Used by the show
   * controller's per-char autoplay typer and by user keystrokes.
   */
  appendToPendingChar(ch: string): void;
  /** Drop the last char of the pending line (Backspace). */
  backspacePending(): void;
  /** Replace the pending line wholesale. */
  setPendingLine(text: string): void;
  /** Read the pending line without its prompt prefix. */
  pendingInput(): string;
  /** Commit the pending line to history, leaving an empty pending line. */
  commitPending(): void;
  /** Drop everything (history + pending) — used between loops. */
  clear(): void;
  /** Toggle/show the blinking caret state. Pure visual, no logic side effects. */
  setCaretVisible(visible: boolean): void;
  /**
   * When `false`, the caret stays whatever {@link setCaretVisible} last
   * set it to and the per-frame blink is suppressed. Used by the show
   * controller to keep the caret pinned bright while a line is auto-typing
   * (the eye reads a steady block as part of the typing animation, not a
   * separate blinking element).
   */
  setBlinkEnabled(enabled: boolean): void;
  /** Per-frame tick — advances caret blink and re-renders if dirty. */
  tick(deltaSeconds: number): void;
  dispose(): void;
}

interface PendingState {
  prefix: string;
  body: string;
}

export function createTerminalBuffer(): TerminalBuffer {
  const canvas = document.createElement("canvas");
  canvas.width = CANVAS_WIDTH;
  canvas.height = CANVAS_HEIGHT;
  const ctx = canvas.getContext("2d");
  if (!ctx) {
    throw new Error("wizard-zork-pc: 2D context not available for terminal buffer");
  }

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.minFilter = THREE.LinearFilter;
  texture.magFilter = THREE.LinearFilter;
  texture.generateMipmaps = false;
  texture.anisotropy = 1;

  const history: string[] = [];
  let pending: PendingState = { prefix: PROMPT + " ", body: "" };
  let dirty = true;
  let caretVisible = true;
  let caretClock = 0;
  let blinkEnabled = true;

  function pushHistory(text: string) {
    const lines = text.split("\n");
    for (const line of lines) {
      history.push(line);
      while (history.length > MAX_LINES) history.shift();
    }
    dirty = true;
  }

  function paintScanlines() {
    ctx!.fillStyle = SCANLINE;
    for (let y = 0; y < CANVAS_HEIGHT; y += 3) {
      ctx!.fillRect(0, y, CANVAS_WIDTH, 1);
    }
  }

  function redraw() {
    ctx!.fillStyle = BG;
    ctx!.fillRect(0, 0, CANVAS_WIDTH, CANVAS_HEIGHT);

    // Subtle vignette on the source — the screen shader adds a stronger
    // one but a hint here keeps the corners from looking flat when the
    // bloom pass washes over them.
    const grad = ctx!.createRadialGradient(
      CANVAS_WIDTH / 2,
      CANVAS_HEIGHT / 2,
      CANVAS_WIDTH * 0.25,
      CANVAS_WIDTH / 2,
      CANVAS_HEIGHT / 2,
      CANVAS_WIDTH * 0.7,
    );
    grad.addColorStop(0, "rgba(0,0,0,0)");
    grad.addColorStop(1, "rgba(0,0,0,0.4)");
    ctx!.fillStyle = grad;
    ctx!.fillRect(0, 0, CANVAS_WIDTH, CANVAS_HEIGHT);

    ctx!.font = `${FONT_SIZE}px ui-monospace, "SFMono-Regular", Menlo, Consolas, monospace`;
    ctx!.textBaseline = "top";
    ctx!.fillStyle = PHOSPHOR;
    ctx!.shadowColor = "rgba(255, 177, 74, 0.45)";
    ctx!.shadowBlur = 6;

    const lines = [...history];
    const pendingLine = pending.prefix + pending.body;
    if (pendingLine.length > 0 || pending.prefix.length > 0) {
      lines.push(pendingLine);
    }
    while (lines.length > MAX_LINES) lines.shift();

    let y = PADDING_TOP;
    for (const line of lines) {
      ctx!.fillText(line, PADDING_X, y);
      y += LINE_HEIGHT;
    }

    ctx!.shadowBlur = 0;

    if (caretVisible) {
      // Caret sits at the end of the pending line, drawn as a solid
      // amber block to match the era's hardware cursors.
      const caretLine = pending.prefix + pending.body;
      const metrics = ctx!.measureText(caretLine);
      const caretX = PADDING_X + metrics.width + 2;
      const caretY = PADDING_TOP + (lines.length - 1) * LINE_HEIGHT;
      ctx!.fillStyle = PHOSPHOR_DIM;
      ctx!.fillRect(caretX, caretY + 2, FONT_SIZE * 0.6, FONT_SIZE);
    }

    paintScanlines();

    texture.needsUpdate = true;
  }

  return {
    texture,
    appendLine(text: string) {
      pushHistory(text);
    },
    beginPendingLine(prefix = PROMPT + " ") {
      pending = { prefix, body: "" };
      dirty = true;
    },
    appendToPendingChar(ch: string) {
      pending = { prefix: pending.prefix, body: pending.body + ch };
      dirty = true;
    },
    backspacePending() {
      if (pending.body.length === 0) return;
      pending = {
        prefix: pending.prefix,
        body: pending.body.slice(0, -1),
      };
      dirty = true;
    },
    setPendingLine(text: string) {
      pending = { prefix: pending.prefix, body: text };
      dirty = true;
    },
    pendingInput() {
      return pending.body;
    },
    commitPending() {
      pushHistory(pending.prefix + pending.body);
      pending = { prefix: pending.prefix, body: "" };
      dirty = true;
    },
    clear() {
      history.length = 0;
      pending = { prefix: pending.prefix, body: "" };
      dirty = true;
    },
    setCaretVisible(v: boolean) {
      if (caretVisible === v) return;
      caretVisible = v;
      dirty = true;
    },
    setBlinkEnabled(v: boolean) {
      blinkEnabled = v;
    },
    tick(delta: number) {
      if (blinkEnabled) {
        caretClock += delta;
        // ~0.83 Hz blink (0.6 s on, 0.6 s off) — slow enough to read as
        // a hardware cursor rather than a flicker.
        const phase = Math.floor(caretClock / 0.6) % 2 === 0;
        if (phase !== caretVisible) {
          caretVisible = phase;
          dirty = true;
        }
      }
      if (dirty) {
        dirty = false;
        redraw();
      }
    },
    dispose() {
      texture.dispose();
    },
  };
}
