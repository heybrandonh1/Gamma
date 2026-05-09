"use client";

import { useEffect, useRef, useState } from "react";
import * as THREE from "three";

import { createParticleSystem } from "./particle-system";
import {
  createMorphController,
  type MorphController,
  type MorphFrame,
} from "./morph-controller";
import { buildFrames } from "./league-data";
import { VibeFallback } from "../_shared/vibe-fallback";

export interface LogoForgeProps {
  /**
   * Folder URL where SVG silhouettes live (no trailing slash needed). The
   * host app is responsible for placing the files at `${logosBaseUrl}/baseball.svg`
   * etc — the bundled `sync-gamma-assets` script handles this in Project Alpha.
   */
  logosBaseUrl: string;
  /** Override the default sport cycle. */
  frames?: MorphFrame[];
  /** When true, the morph cycle pauses on the first frame. */
  reduceMotion?: boolean | null;
  /** CSS aspect-ratio for the canvas wrapper. Defaults to "1 / 0.72". */
  aspectRatio?: string;
  /** Particle count. 3000 is the sweet spot on midrange laptops. */
  particleCount?: number;
  className?: string;
}

function hasWebGL(): boolean {
  if (typeof document === "undefined") return false;
  try {
    const canvas = document.createElement("canvas");
    const gl =
      canvas.getContext("webgl") ||
      canvas.getContext("experimental-webgl");
    return !!gl;
  } catch {
    return false;
  }
}

export function LogoForge({
  logosBaseUrl,
  frames,
  reduceMotion,
  aspectRatio = "1 / 0.72",
  particleCount = 3000,
  className,
}: LogoForgeProps) {
  const mountRef = useRef<HTMLDivElement>(null);
  const reduceMotionRef = useRef(reduceMotion ?? false);
  const controllerRef = useRef<MorphController | null>(null);
  const [failed, setFailed] = useState(false);
  const [activeFrame, setActiveFrame] = useState<MorphFrame | null>(null);

  reduceMotionRef.current = reduceMotion ?? false;

  useEffect(() => {
    controllerRef.current?.setReducedMotion(reduceMotion ?? false);
  }, [reduceMotion]);

  useEffect(() => {
    const mount = mountRef.current;
    if (!mount) return;

    if (!hasWebGL()) {
      setFailed(true);
      return;
    }

    let alive = true;
    let raf = 0;

    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(45, 1, 0.1, 100);
    camera.position.set(0, 0, 5);
    camera.lookAt(0, 0, 0);

    let renderer: THREE.WebGLRenderer;
    try {
      renderer = new THREE.WebGLRenderer({
        antialias: true,
        alpha: true,
        powerPreference: "high-performance",
      });
    } catch (err) {
      console.error("[logo-forge] WebGL init failed:", err);
      setFailed(true);
      return;
    }
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.setClearColor(0x000000, 0);

    const system = createParticleSystem({ count: particleCount });
    scene.add(system.points);

    const resolvedFrames = frames ?? buildFrames(logosBaseUrl);

    const controller = createMorphController({
      system,
      frames: resolvedFrames,
      reducedMotion: reduceMotionRef.current,
    });
    controllerRef.current = controller;

    const unsub = controller.onFrameSettled((_i, frame) => {
      if (!alive) return;
      setActiveFrame(frame);
    });

    controller.ready.catch((err) => {
      console.warn("[logo-forge] failed to load svg samples:", err);
    });

    const resize = () => {
      const w = Math.max(280, mount.clientWidth || 400);
      const h = Math.max(280, Math.round(w * 0.72));
      camera.aspect = w / h;
      // Keep a consistent silhouette size whether the card is wide or narrow
      // by tracking aspect into the view.
      camera.updateProjectionMatrix();
      renderer.setSize(w, h);
    };

    mount.appendChild(renderer.domElement);
    resize();
    const ro = new ResizeObserver(resize);
    ro.observe(mount);

    renderer.domElement.style.touchAction = "none";
    renderer.domElement.style.cursor = "pointer";

    const onClick = () => {
      if (reduceMotionRef.current) return;
      controller.next();
    };
    renderer.domElement.addEventListener("click", onClick);

    const tick = (now: number) => {
      if (!alive) return;
      raf = requestAnimationFrame(tick);
      controller.update(now);
      renderer.render(scene, camera);
    };
    raf = requestAnimationFrame(tick);

    return () => {
      alive = false;
      cancelAnimationFrame(raf);
      ro.disconnect();
      renderer.domElement.removeEventListener("click", onClick);
      unsub();
      controller.dispose();
      controllerRef.current = null;
      scene.remove(system.points);
      system.dispose();
      renderer.dispose();
      if (renderer.domElement.parentNode === mount) {
        mount.removeChild(renderer.domElement);
      }
    };
    // logosBaseUrl + particleCount are scene-shaping props — changing them
    // tears down and rebuilds. reduceMotion is pulled through the ref.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [logosBaseUrl, particleCount, frames]);

  if (failed) return <VibeFallback aspectRatio={aspectRatio} className={className} />;

  return (
    <div
      ref={mountRef}
      className={
        "relative w-full overflow-hidden rounded-xl border border-foreground/10 " +
        // Deep midnight gradient — the additive particles need a dark
        // canvas to read as glowing dust.
        "bg-[radial-gradient(ellipse_at_center,#1a1d35_0%,#0a0c1a_70%,#05060f_100%)] " +
        "shadow-[0_20px_50px_-24px_rgba(0,0,0,0.55)] " +
        (className ?? "")
      }
      style={{ aspectRatio }}
      role="img"
      aria-label={
        activeFrame
          ? `Particle silhouette of a ${activeFrame.name.toLowerCase()}`
          : "Particle logo forge"
      }
    >
      {activeFrame && (
        <div className="pointer-events-none absolute inset-x-0 bottom-0 flex flex-col items-center gap-1 px-6 pb-6 text-center">
          <span className="text-[10px] uppercase tracking-[0.2em] text-white/40">
            Sport
          </span>
          <span className="text-base font-medium text-white/85">
            {activeFrame.name}
          </span>
          <span className="text-xs leading-tight text-white/45">
            {activeFrame.caption}
          </span>
        </div>
      )}
    </div>
  );
}
