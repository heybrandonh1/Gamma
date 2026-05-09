"use client";

import {
  useEffect,
  useState,
  type CSSProperties,
  type ReactNode,
} from "react";

export interface VibeFallbackProps {
  /**
   * Aspect ratio of the square. Should match whatever the live vibe uses
   * so swapping the fallback in doesn't reflow the page (defaults to the
   * disco-dancer ratio of 1 / 0.72).
   */
  aspectRatio?: string;
  /** Override the message — defaults to the friendly "Sorry!" copy. */
  message?: string;
  /** Optional smaller hint shown below the main message. */
  hint?: ReactNode;
  /**
   * Override the auto-detected emoji row. When omitted, the fallback picks
   * a set based on the runtime environment (WebGPU support, online status,
   * mobile vs. desktop). Pass `""` to hide the row entirely.
   */
  emojis?: string;
  className?: string;
  style?: CSSProperties;
}

const DEFAULT_MESSAGE =
  "Sorry! We can't load this cool stuff at this time. This design requires WebGPU.";

type FallbackContext = "default" | "no-webgpu" | "mobile" | "offline";

// Emoji rows are written with `\u{...}` escapes so the source file stays
// pure ASCII regardless of editor / git encoding settings. The visible
// glyphs are noted alongside.
const EMOJIS_BY_CONTEXT: Record<FallbackContext, string> = {
  // 👀 🚨 ✋ — generic "heads up, can't render" attention grab.
  default: "\u{1F440} \u{1F6A8} \u{270B}",
  // 🖥️ 🚫 ✋ — desktop browser without WebGPU (Safari / Firefox stable).
  "no-webgpu": "\u{1F5A5}\u{FE0F} \u{1F6AB} \u{270B}",
  // 📱 ⚠️ ✋ — phone / tablet, where the design wasn't built to run.
  mobile: "\u{1F4F1} \u{26A0}\u{FE0F} \u{270B}",
  // 📡 ⚠️ 🔌 — looks like the device is offline / chunk fetch failed.
  offline: "\u{1F4E1} \u{26A0}\u{FE0F} \u{1F50C}",
};

/**
 * Pick a context bucket based on the live environment. Runs only on the
 * client (after mount) so SSR always serves the safe `"default"` set —
 * that keeps initial HTML deterministic and avoids hydration mismatches.
 */
function detectFallbackContext(): FallbackContext {
  if (typeof navigator === "undefined") return "default";

  // Order matters: most specific / actionable reason first.
  if ("onLine" in navigator && navigator.onLine === false) return "offline";

  // WebGPU is the headline reason vibes fail today — Safari and Firefox
  // stable still ship without `navigator.gpu`. Check this before mobile so
  // the more specific reason wins on phones that also lack it.
  if (!("gpu" in navigator)) return "no-webgpu";

  const ua = navigator.userAgent || "";
  if (/Mobi|Android|iPhone|iPad|iPod/i.test(ua)) return "mobile";

  return "default";
}

/**
 * Universal "we couldn't render this vibe" placeholder.
 *
 * It's pure JSX and CSS — no three.js, no canvas, no event listeners — so it
 * can never itself fail. That's the whole point: this is the safe square the
 * playground falls back to when:
 *
 *   1. JavaScript is disabled in the browser (rendered inside `<noscript>`).
 *   2. The dynamic chunk for a vibe fails to download (chunk-load error).
 *   3. The chunk loaded but the vibe threw at render time (caught by the
 *      host's `<VibeErrorBoundary>`).
 *   4. The browser doesn't support WebGL/WebGPU or a hardware-init step
 *      throws — vibes render this directly from their failed-state branch.
 *
 * The wrapper styles (border, rounded-xl, light card bg, soft shadow) match
 * the disco-dancer's live wrapper exactly so failure mode and success mode
 * occupy the same footprint. The emoji row swaps to a context-appropriate
 * set on mount (offline / no-WebGPU / mobile / default).
 */
export function VibeFallback({
  aspectRatio = "1 / 0.72",
  message = DEFAULT_MESSAGE,
  hint,
  emojis,
  className,
  style,
}: VibeFallbackProps) {
  // Start with the safe default so server and first client render agree;
  // upgrade to the detected set after mount.
  const [detectedEmojis, setDetectedEmojis] = useState<string>(
    EMOJIS_BY_CONTEXT.default,
  );

  useEffect(() => {
    if (emojis !== undefined) return;
    setDetectedEmojis(EMOJIS_BY_CONTEXT[detectFallbackContext()]);
  }, [emojis]);

  const renderedEmojis = emojis ?? detectedEmojis;

  return (
    <div
      role="status"
      aria-live="polite"
      className={
        "relative flex w-full items-center justify-center overflow-hidden rounded-xl border border-foreground/10 " +
        "bg-[color-mix(in_srgb,var(--color-background)_92%,#a0a0a0)] " +
        "shadow-[0_20px_50px_-24px_rgba(0,0,0,0.35)] " +
        "dark:bg-[color-mix(in_srgb,var(--color-background)_88%,#555)] " +
        (className ?? "")
      }
      style={{ aspectRatio, ...style }}
    >
      <div className="flex max-w-[80%] flex-col items-center gap-3 px-6 text-center">
        {renderedEmojis ? (
          <div
            aria-hidden="true"
            className="text-3xl leading-none tracking-[0.15em]"
          >
            {renderedEmojis}
          </div>
        ) : null}
        <p className="text-sm leading-relaxed text-foreground/70">{message}</p>
        {hint ? (
          <p className="text-xs leading-relaxed text-foreground/50">{hint}</p>
        ) : null}
      </div>
    </div>
  );
}
