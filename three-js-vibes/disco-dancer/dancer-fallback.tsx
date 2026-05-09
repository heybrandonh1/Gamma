"use client";

import type { CSSProperties } from "react";

interface DancerFallbackProps {
  aspectRatio?: string;
  className?: string;
  style?: CSSProperties;
}

/**
 * Static fallback shown:
 *   1. While the lazy-loaded WebGL chunk is being fetched.
 *   2. When the browser doesn't support WebGL (or it's blocked).
 *   3. When the WebGL renderer / FBX loader throws.
 *
 * Pure SVG/CSS, zero JS dependencies — so it can never itself fail.
 *
 * The card chrome (rounded corners, light bg, subtle shadow) is the same
 * color recipe the live `DiscoDancer` wrapper uses, so swapping in the
 * fallback doesn't shift the layout at all.
 */
export function DancerFallback({
  aspectRatio = "1 / 0.72",
  className,
  style,
}: DancerFallbackProps) {
  return (
    <div
      role="img"
      aria-label="A faceted disco ball"
      className={
        "relative w-full overflow-hidden rounded-xl border border-foreground/10 " +
        "bg-[color-mix(in_srgb,var(--color-background)_92%,#a0a0a0)] " +
        "shadow-[0_20px_50px_-24px_rgba(0,0,0,0.35)] " +
        "dark:bg-[color-mix(in_srgb,var(--color-background)_88%,#555)] " +
        (className ?? "")
      }
      style={{ aspectRatio, ...style }}
    >
      <svg
        viewBox="0 0 200 200"
        className="absolute inset-0 m-auto h-2/3 w-2/3"
        aria-hidden
      >
        {/* String to the ceiling. */}
        <line x1="100" y1="0" x2="100" y2="56" stroke="#9ca3af" strokeWidth="2" />
        {/* Cap. */}
        <rect x="92" y="52" width="16" height="8" rx="2" fill="#9ca3af" />
        {/* Ball body — soft chrome gradient. */}
        <defs>
          <radialGradient id="ball" cx="40%" cy="38%" r="60%">
            <stop offset="0%" stopColor="#ffffff" />
            <stop offset="55%" stopColor="#cbd5e1" />
            <stop offset="100%" stopColor="#475569" />
          </radialGradient>
        </defs>
        <circle cx="100" cy="118" r="54" fill="url(#ball)" />
        {/* A few mirror facets to hint at the disco-ball texture. */}
        <g fill="#1f2937" opacity="0.18">
          <rect x="78" y="92" width="14" height="10" />
          <rect x="100" y="86" width="16" height="10" />
          <rect x="120" y="100" width="12" height="10" />
          <rect x="86" y="120" width="14" height="10" />
          <rect x="108" y="124" width="14" height="10" />
          <rect x="76" y="138" width="12" height="10" />
          <rect x="120" y="138" width="14" height="10" />
        </g>
        {/* Highlights. */}
        <g fill="#ffffff" opacity="0.65">
          <ellipse cx="84" cy="100" rx="6" ry="3" />
          <ellipse cx="78" cy="110" rx="3" ry="2" />
        </g>
      </svg>
    </div>
  );
}
