"use client";

import { useEffect, useRef, useState } from "react";
import * as THREE from "three";

import {
  buildBaseball,
  buildBat,
  buildBasketball,
  buildFootball,
  buildSoccerBall,
  buildHockeyPuck,
  type SportMesh,
} from "./mesh-builders";
import {
  createShowController,
  type ShowController,
  type ShowFrame,
} from "./show-controller";
import { VibeFallback } from "../_shared/vibe-fallback";

export interface LogoForgeProps {
  /** Pause the cycle and rotation when true. */
  reduceMotion?: boolean | null;
  /** CSS aspect-ratio for the canvas wrapper. Defaults to "1 / 0.72". */
  aspectRatio?: string;
  className?: string;
}

interface ActiveFrameInfo {
  name: string;
  caption: string;
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
  reduceMotion,
  aspectRatio = "1 / 0.72",
  className,
}: LogoForgeProps) {
  const mountRef = useRef<HTMLDivElement>(null);
  const reduceMotionRef = useRef(reduceMotion ?? false);
  const controllerRef = useRef<ShowController | null>(null);
  const [failed, setFailed] = useState(false);
  const [activeFrame, setActiveFrame] = useState<ActiveFrameInfo | null>(null);

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
    const camera = new THREE.PerspectiveCamera(38, 1, 0.1, 100);
    camera.position.set(0, 0, 4.2);
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
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.15;

    // Lighting: low ambient base + bright key/fill so the materials read
    // their color without being lost in shadow, plus a colored rim point
    // light that the show controller crossfades per sport for that
    // "atmosphere shifts when the object changes" effect.
    const ambient = new THREE.AmbientLight(0xffffff, 0.45);
    scene.add(ambient);

    const keyLight = new THREE.DirectionalLight(0xfff2dd, 1.3);
    keyLight.position.set(2.5, 3, 4);
    scene.add(keyLight);

    const fillLight = new THREE.DirectionalLight(0xb6c8ff, 0.55);
    fillLight.position.set(-3, -1, 2);
    scene.add(fillLight);

    const rimLight = new THREE.PointLight(0xffd58a, 6, 10, 1.6);
    rimLight.position.set(-2, -0.5, -2.5);
    scene.add(rimLight);

    // Build the six meshes and add them to the scene up front (controller
    // toggles visibility via opacity + scale + visible).
    const meshes: SportMesh[] = [
      buildBaseball(),
      buildBat(),
      buildBasketball(),
      buildFootball(),
      buildSoccerBall(),
      buildHockeyPuck(),
    ];
    meshes.forEach((m) => scene.add(m.mesh));

    const frames: ShowFrame[] = [
      {
        sportMesh: meshes[0],
        name: "Baseball",
        caption: "Cowhide & red stitches",
        rimColor: "#ffd58a",
      },
      {
        sportMesh: meshes[1],
        name: "Bat",
        caption: "Northern white ash, lathe-turned",
        rimColor: "#e6c089",
      },
      {
        sportMesh: meshes[2],
        name: "Basketball",
        caption: "Pebbled grain, eight-panel seam",
        rimColor: "#ff8a3a",
      },
      {
        sportMesh: meshes[3],
        name: "Football",
        caption: "Pigskin laces, autumn light",
        rimColor: "#d4a36d",
      },
      {
        sportMesh: meshes[4],
        name: "Soccer Ball",
        caption: "Twelve pentagons, twenty hexagons",
        rimColor: "#cfdcff",
      },
      {
        sportMesh: meshes[5],
        name: "Hockey Puck",
        caption: "Vulcanized rubber, frozen smooth",
        rimColor: "#9fb4cc",
      },
    ];

    const controller = createShowController({ frames, rimLight });
    controllerRef.current = controller;
    const unsub = controller.onFrameSettled((_i, frame) => {
      if (!alive) return;
      setActiveFrame({ name: frame.name, caption: frame.caption });
    });
    controller.setReducedMotion(reduceMotionRef.current);
    controller.start();

    const resize = () => {
      const w = Math.max(280, mount.clientWidth || 400);
      const h = Math.max(280, Math.round(w * 0.72));
      camera.aspect = w / h;
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

    // Mouse parallax (damped) layered over a slow lissajous idle drift so
    // the camera always has gentle motion even before any input.
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

    const clock = new THREE.Clock();

    const tick = () => {
      if (!alive) return;
      raf = requestAnimationFrame(tick);
      const delta = clock.getDelta();
      const elapsed = clock.getElapsedTime();

      if (!reduceMotionRef.current) controller.update(delta);

      const driftX = Math.sin(elapsed * 0.32) * 0.18;
      const driftY = Math.cos(elapsed * 0.27) * 0.13;
      const aimX = mx * 0.45 + driftX;
      const aimY = my * 0.32 + driftY;
      camera.position.x += (aimX - camera.position.x) * 0.04;
      camera.position.y += (aimY - camera.position.y) * 0.04;
      camera.lookAt(0, 0, 0);

      renderer.render(scene, camera);
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
      meshes.forEach((m) => {
        scene.remove(m.mesh);
        m.dispose();
      });
      renderer.dispose();
      if (renderer.domElement.parentNode === mount) {
        mount.removeChild(renderer.domElement);
      }
    };
  }, []);

  if (failed) return <VibeFallback aspectRatio={aspectRatio} className={className} />;

  return (
    <div
      ref={mountRef}
      className={
        "relative w-full overflow-hidden rounded-xl border border-foreground/10 " +
        "shadow-[0_20px_50px_-24px_rgba(0,0,0,0.55)] " +
        (className ?? "")
      }
      style={{
        aspectRatio,
        backgroundColor: "#0a0c1a",
        backgroundImage:
          "radial-gradient(ellipse at center, #1a1d35 0%, #0a0c1a 70%, #05060f 100%)",
      }}
      role="img"
      aria-label={
        activeFrame
          ? `3D model of a ${activeFrame.name.toLowerCase()}`
          : "3D sport object showcase"
      }
    >
      {activeFrame && (
        <div className="pointer-events-none absolute inset-x-0 bottom-0 flex flex-col items-center gap-1 px-6 pb-6 text-center">
          <span className="text-[10px] uppercase tracking-[0.2em] text-white/40">
            Sport
          </span>
          <span className="text-base font-medium text-white/90">
            {activeFrame.name}
          </span>
          <span className="text-xs leading-tight text-white/55">
            {activeFrame.caption}
          </span>
        </div>
      )}
    </div>
  );
}
