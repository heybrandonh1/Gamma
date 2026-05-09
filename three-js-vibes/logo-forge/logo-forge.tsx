"use client";

import { useEffect, useRef, useState } from "react";
import * as THREE from "three";
import { EffectComposer } from "three/examples/jsm/postprocessing/EffectComposer.js";
import { RenderPass } from "three/examples/jsm/postprocessing/RenderPass.js";
import { UnrealBloomPass } from "three/examples/jsm/postprocessing/UnrealBloomPass.js";
import { OutputPass } from "three/examples/jsm/postprocessing/OutputPass.js";

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

    // Post-processing pipeline: render the scene → bloom the additive
    // particles for that "real glow" look → tonemap/output. Bloom strength
    // is tuned for the dark midnight bg; bump `0.9` if your background is
    // even darker.
    const composer = new EffectComposer(renderer);
    const renderPass = new RenderPass(scene, camera);
    composer.addPass(renderPass);
    const bloomPass = new UnrealBloomPass(
      new THREE.Vector2(800, 600),
      /* strength */ 0.9,
      /* radius   */ 0.55,
      /* threshold*/ 0.08,
    );
    composer.addPass(bloomPass);
    const outputPass = new OutputPass();
    composer.addPass(outputPass);

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
      camera.updateProjectionMatrix();
      renderer.setSize(w, h);
      composer.setSize(w, h);
      bloomPass.setSize(w, h);
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

    // Mouse parallax: track normalized pointer (-1..1) and ease the camera
    // toward it. When the cursor isn't moving, layer in a slow lissajous
    // drift so the scene never looks frozen.
    let mx = 0;
    let my = 0;
    const onPointer = (e: PointerEvent) => {
      const rect = renderer.domElement.getBoundingClientRect();
      mx = ((e.clientX - rect.left) / rect.width) * 2 - 1;
      my = -(((e.clientY - rect.top) / rect.height) * 2 - 1);
    };
    const onPointerLeave = () => {
      mx = 0;
      my = 0;
    };
    renderer.domElement.addEventListener("pointermove", onPointer);
    renderer.domElement.addEventListener("pointerleave", onPointerLeave);

    const tick = (now: number) => {
      if (!alive) return;
      raf = requestAnimationFrame(tick);
      controller.update(now);

      // Camera parallax: damped follow of pointer + slow lissajous idle
      // motion. Together these give the scene a sense of weight even before
      // a morph kicks off.
      const driftX = Math.sin(now * 0.00028) * 0.18;
      const driftY = Math.cos(now * 0.00022) * 0.14;
      const aimX = mx * 0.45 + driftX;
      const aimY = my * 0.35 + driftY;
      camera.position.x += (aimX - camera.position.x) * 0.04;
      camera.position.y += (aimY - camera.position.y) * 0.04;
      camera.lookAt(0, 0, 0);

      composer.render();
    };
    raf = requestAnimationFrame(tick);

    return () => {
      alive = false;
      cancelAnimationFrame(raf);
      ro.disconnect();
      renderer.domElement.removeEventListener("click", onClick);
      renderer.domElement.removeEventListener("pointermove", onPointer);
      renderer.domElement.removeEventListener("pointerleave", onPointerLeave);
      unsub();
      controller.dispose();
      controllerRef.current = null;
      scene.remove(system.points);
      system.dispose();
      bloomPass.dispose();
      composer.dispose();
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
        "shadow-[0_20px_50px_-24px_rgba(0,0,0,0.55)] " +
        (className ?? "")
      }
      // Deep midnight gradient inlined as a style, not a Tailwind arbitrary
      // class. Tailwind 4 needs `bg-[image:...]` to treat a function value as
      // background-image; without that prefix it falls back to background-color
      // (invalid → ignored) and the additive white particles render against a
      // transparent / page-color background, which looks like an empty white
      // card. Solid fallback color sits under the gradient so even if the
      // gradient itself fails to parse on some browser, the canvas stays dark.
      style={{
        aspectRatio,
        backgroundColor: "#0a0c1a",
        backgroundImage:
          "radial-gradient(ellipse at center, #1a1d35 0%, #0a0c1a 70%, #05060f 100%)",
      }}
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
