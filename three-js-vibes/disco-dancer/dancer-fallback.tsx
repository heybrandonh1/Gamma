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
 */
export function DancerFallback({
  aspectRatio = "1 / 0.72",
  className,
  style,
}: DancerFallbackProps) {
  return (
    <div
      role="img"
      aria-label="A glowing golden key"
      className={
        "relative w-full overflow-hidden rounded-xl border border-black/10 bg-[#101216] " +
        (className ?? "")
      }
      style={{ aspectRatio, ...style }}
    >
      <svg
        viewBox="0 0 200 200"
        className="absolute inset-0 m-auto h-1/2 w-1/2"
        fill="none"
        aria-hidden
      >
        <circle
          cx="80"
          cy="80"
          r="34"
          stroke="#d4a017"
          strokeWidth="10"
          fill="none"
        />
        <circle cx="80" cy="80" r="10" fill="#d4a017" />
        <rect x="108" y="74" width="70" height="12" fill="#d4a017" rx="2" />
        <rect x="148" y="86" width="10" height="18" fill="#d4a017" />
        <rect x="166" y="86" width="10" height="14" fill="#d4a017" />
      </svg>
    </div>
  );
}
