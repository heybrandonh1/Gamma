"use client";

import { useEffect, useRef, useState } from "react";
import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { RoomEnvironment } from "three/examples/jsm/environments/RoomEnvironment.js";

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
    const camera = new THREE.PerspectiveCamera(35, 1, 0.1, 100);
    camera.position.set(0, 0, 5.0);
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

    // PMREM-generated environment map from a procedural RoomEnvironment.
    // No external HDR asset needed — three.js builds a soft studio-style
    // cubemap on the fly. This is the single biggest contributor to
    // "objects look like real physical things" because MeshStandardMaterial
    // can finally pick up reflections / image-based lighting on its rough
    // surfaces. Without it, materials read flat.
    const pmrem = new THREE.PMREMGenerator(renderer);
    const envTexture = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
    scene.environment = envTexture;

    // Lighting on top of the IBL: a soft ambient floor + a warm directional
    // key for shape definition + a colored rim point light that the show
    // controller crossfades per sport.
    const ambient = new THREE.AmbientLight(0xffffff, 0.35);
    scene.add(ambient);
    const keyLight = new THREE.DirectionalLight(0xfff2dd, 1.1);
    keyLight.position.set(2.5, 3, 4);
    scene.add(keyLight);
    const fillLight = new THREE.DirectionalLight(0xb6c8ff, 0.5);
    fillLight.position.set(-3, -1, 2);
    scene.add(fillLight);
    const rimLight = new THREE.PointLight(0xffd58a, 5, 10, 1.6);
    rimLight.position.set(-2, -0.5, -2.5);
    scene.add(rimLight);

    // Build the six sport meshes. They're added to the scene up front; the
    // show controller toggles `visible` + scale + opacity per cycle.
    const meshes: SportMesh[] = [
      buildBaseball(),
      buildBat(),
      buildBasketball(),
      buildFootball(),
      buildSoccerBall(),
      buildHockeyPuck(),
    ];
    meshes.forEach((m) => scene.add(m.object));

    const frames: ShowFrame[] = [
      { sportMesh: meshes[0], name: "Baseball", caption: "", rimColor: "#ffd58a" },
      { sportMesh: meshes[1], name: "Bat", caption: "", rimColor: "#e6c089" },
      { sportMesh: meshes[2], name: "Basketball", caption: "", rimColor: "#ff8a3a" },
      { sportMesh: meshes[3], name: "Football", caption: "", rimColor: "#d4a36d" },
      { sportMesh: meshes[4], name: "Soccer Ball", caption: "", rimColor: "#cfdcff" },
      { sportMesh: meshes[5], name: "Hockey Puck", caption: "", rimColor: "#9fb4cc" },
    ];

    const controller = createShowController({ frames, rimLight });
    controllerRef.current = controller;
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

    // Free 360° rotation: OrbitControls owns pointer input. Zoom + pan are
    // disabled (we want pure inspection-grade rotation, not a flythrough).
    // Polar limits are wide open so the user can flip the camera under and
    // over the object — true 360° in every direction.
    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.08;
    controls.enableZoom = false;
    controls.enablePan = false;
    controls.rotateSpeed = 0.8;
    controls.minPolarAngle = 0;
    controls.maxPolarAngle = Math.PI;
    controls.target.set(0, 0, 0);
    renderer.domElement.style.touchAction = "none";
    renderer.domElement.style.cursor = "grab";

    const onDown = () => {
      renderer.domElement.style.cursor = "grabbing";
    };
    const onUp = () => {
      renderer.domElement.style.cursor = "grab";
    };
    renderer.domElement.addEventListener("pointerdown", onDown);
    window.addEventListener("pointerup", onUp);

    const clock = new THREE.Clock();

    const tick = () => {
      if (!alive) return;
      raf = requestAnimationFrame(tick);
      const delta = clock.getDelta();

      if (!reduceMotionRef.current) controller.update(delta);
      controls.update();

      renderer.render(scene, camera);
    };
    raf = requestAnimationFrame(tick);

    return () => {
      alive = false;
      cancelAnimationFrame(raf);
      ro.disconnect();
      controls.dispose();
      renderer.domElement.removeEventListener("pointerdown", onDown);
      window.removeEventListener("pointerup", onUp);
      controller.dispose();
      controllerRef.current = null;
      meshes.forEach((m) => {
        scene.remove(m.object);
        m.dispose();
      });
      scene.environment = null;
      envTexture.dispose();
      pmrem.dispose();
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
      aria-label="3D sporting equipment carousel — drag to rotate"
    />
  );
}
