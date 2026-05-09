"use client";

import type { CSSProperties, ReactNode } from "react";

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
  className?: string;
  style?: CSSProperties;
}

const DEFAULT_MESSAGE = "Sorry! We can't load this cool stuff at this time";

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
 *   4. The browser doesn't support WebGL or a WebGL init step throws — vibes
 *      render this directly from their failed-state branch.
 *
 * The wrapper styles (border, rounded-xl, light card bg, soft shadow) match
 * the disco-dancer's live wrapper exactly so failure mode and success mode
 * occupy the same footprint.
 */
export function VibeFallback({
  aspectRatio = "1 / 0.72",
  message = DEFAULT_MESSAGE,
  hint,
  className,
  style,
}: VibeFallbackProps) {
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
      <div className="flex max-w-[80%] flex-col items-center gap-2 px-6 text-center">
        <p className="text-sm leading-relaxed text-foreground/70">{message}</p>
        {hint ? (
          <p className="text-xs leading-relaxed text-foreground/50">{hint}</p>
        ) : null}
      </div>
    </div>
  );
}
