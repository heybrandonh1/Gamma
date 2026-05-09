import type { ShowController } from "./show-controller";

/**
 * Captures keyboard input for the hybrid Zork prompt and routes it into
 * the {@link ShowController}.
 *
 * Why a hidden `<input>` instead of just listening on `window`?
 *
 *   1. **Mobile keyboards.** A `keydown` listener on `window` won't
 *      open the on-screen keyboard on iOS/Android. A focused
 *      `<input type="text">` will. We focus it on `pointerdown` over
 *      the canvas so tapping the CRT does the right thing on touch.
 *
 *   2. **Scope.** The Playground page mounts other vibes alongside
 *      this one. If we listened on `window` and a visitor was just
 *      passing through, every keystroke (including arrow keys for
 *      page nav) would dump into Zork's prompt. The hidden input
 *      requires explicit focus — once the visitor clicks elsewhere,
 *      blur fires and we stop accepting input.
 *
 *   3. **IME / composition.** The hidden input handles
 *      `compositionstart`/`compositionend` for free, which we wouldn't
 *      get from raw `keydown` (matters for non-Latin keyboards).
 *
 * The visible caret is the canvas terminal's painted block, not the
 * real input's cursor — the input itself is fully off-screen and
 * styled invisible. We mirror its `value` into the show controller's
 * pending-line state via `keydown` rather than `input` so we can
 * intercept Enter without committing the form.
 */

export interface InputController {
  /** Element to focus when the user clicks the canvas. */
  readonly hiddenInput: HTMLInputElement;
  /** Wire `pointerdown` on the canvas to focus the input. */
  attachToCanvas(canvas: HTMLElement): () => void;
  dispose(): void;
}

export interface InputControllerOptions {
  controller: ShowController;
}

const PRINTABLE_CHAR_RE = /^[\x20-\x7E]$/u;

export function createInputController(opts: InputControllerOptions): InputController {
  const { controller } = opts;

  const input = document.createElement("input");
  input.type = "text";
  input.autocomplete = "off";
  input.autocapitalize = "off";
  input.spellcheck = false;
  input.setAttribute("inputmode", "text");
  input.setAttribute("aria-label", "Zork terminal input");
  input.setAttribute("aria-hidden", "true");
  input.tabIndex = -1;
  // Position off-screen but still focusable. `display: none` would
  // prevent focus / keyboard activation, hence the absolute trick.
  input.style.position = "absolute";
  input.style.left = "-9999px";
  input.style.top = "0";
  input.style.opacity = "0";
  input.style.pointerEvents = "none";
  input.style.width = "1px";
  input.style.height = "1px";

  document.body.appendChild(input);

  let composing = false;
  function onCompositionStart() {
    composing = true;
  }
  function onCompositionEnd(e: CompositionEvent) {
    composing = false;
    for (const ch of e.data ?? "") {
      if (PRINTABLE_CHAR_RE.test(ch)) controller.onUserChar(ch);
    }
    input.value = "";
  }

  function onKeyDown(e: KeyboardEvent) {
    if (composing) return;
    if (e.key === "Enter") {
      e.preventDefault();
      controller.onUserCommit();
      input.value = "";
      return;
    }
    if (e.key === "Backspace") {
      e.preventDefault();
      controller.onUserBackspace();
      return;
    }
    if (e.key.length === 1 && PRINTABLE_CHAR_RE.test(e.key)) {
      // Don't let the browser show its own input value pile up — we
      // mirror everything into the canvas terminal ourselves.
      e.preventDefault();
      controller.onUserChar(e.key);
    }
  }

  input.addEventListener("keydown", onKeyDown);
  input.addEventListener("compositionstart", onCompositionStart);
  input.addEventListener("compositionend", onCompositionEnd);

  return {
    hiddenInput: input,
    attachToCanvas(canvas: HTMLElement) {
      const onPointerDown = () => {
        // `preventScroll` keeps the page from jumping to the off-screen
        // input's position when focus moves there.
        input.focus({ preventScroll: true });
      };
      canvas.addEventListener("pointerdown", onPointerDown);
      return () => {
        canvas.removeEventListener("pointerdown", onPointerDown);
      };
    },
    dispose() {
      input.removeEventListener("keydown", onKeyDown);
      input.removeEventListener("compositionstart", onCompositionStart);
      input.removeEventListener("compositionend", onCompositionEnd);
      if (input.parentNode) input.parentNode.removeChild(input);
    },
  };
}
