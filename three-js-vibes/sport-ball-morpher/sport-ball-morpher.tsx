"use client";

import { useEffect, useRef, useState } from "react";
import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { RoomEnvironment } from "three/examples/jsm/environments/RoomEnvironment.js";

import {
  createShowController,
  type ShowController,
} from "./show-controller";
import { SPORT_SPECS } from "./sport-specs";
import {
  buildUnifiedSportBody,
  morphedSurfacePoint,
} from "./unified-body";
import { VibeFallback } from "../_shared/vibe-fallback";

export interface SportBallMorpherProps {
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

export function SportBallMorpher({
  reduceMotion,
  aspectRatio = "1 / 0.72",
  className,
}: SportBallMorpherProps) {
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
      console.error("[sport-ball-morpher] WebGL init failed:", err);
      setFailed(true);
      return;
    }
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.setClearColor(0x000000, 0);
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.15;

    // PMREM-generated environment map from a procedural RoomEnvironment.
    // Same as the previous version: turns flat MeshStandardMaterial
    // surfaces into believable physical objects with image-based
    // lighting, no HDR asset required.
    const pmrem = new THREE.PMREMGenerator(renderer);
    const envTexture = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
    scene.environment = envTexture;

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

    // The single morphing body. Holds every sport's per-vertex
    // position + color buffer, smoothstep-interpolates between two
    // slots (A current, B next) on a single `uBlend` uniform.
    const body = buildUnifiedSportBody(SPORT_SPECS);
    scene.add(body.object);

    const controller = createShowController({
      body,
      sports: SPORT_SPECS,
      rimLight,
    });
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

    // Free 360° rotation: OrbitControls owns pointer input. Zoom + pan
    // disabled — this is an inspection view, not a flythrough.
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

    // Click-to-jello: raycast against the rest sphere (radius 1) to get
    // the click direction, then ask the unified body where the *morphed*
    // surface lives along that direction at the current blend. The poke
    // center we hand to the shader is exactly on the visible surface, so
    // the wavy-jello wave radiates outward from where the user actually
    // clicked even mid-morph.
    const CLICK_MAX_PX_SQ = 36;
    const CLICK_MAX_MS = 350;
    const raycaster = new THREE.Raycaster();
    const ndc = new THREE.Vector2();
    const tmpDir = new THREE.Vector3();
    const tmpLocal = new THREE.Vector3();
    // Invisible proxy sphere for the click raycast — the unified body
    // mesh's `position` attribute is the rest unit sphere (the morph
    // happens in the shader), so we can raycast against the body
    // directly and the hit point gives us a direction on the rest
    // sphere. We could also use a separate proxy `Mesh`, but reusing
    // the body itself avoids an extra scene object.
    let downX = 0;
    let downY = 0;
    let downTime = 0;

    const handleClick = (clientX: number, clientY: number) => {
      const rect = renderer.domElement.getBoundingClientRect();
      ndc.set(
        ((clientX - rect.left) / rect.width) * 2 - 1,
        -((clientY - rect.top) / rect.height) * 2 + 1,
      );
      raycaster.setFromCamera(ndc, camera);
      const hits = raycaster.intersectObject(body.object, true);
      if (hits.length === 0) return;
      // Hit point is in world space on the rest unit sphere. Convert
      // to the body's local space, normalize for direction, then
      // project to the morphed surface so the wave originates exactly
      // where the user clicked.
      tmpLocal.copy(hits[0].point);
      body.object.worldToLocal(tmpLocal);
      tmpDir.copy(tmpLocal).normalize();
      const blendInfo = controller.currentBlend();
      morphedSurfacePoint(
        tmpDir,
        blendInfo.blend,
        SPORT_SPECS[blendInfo.slotA],
        SPORT_SPECS[blendInfo.slotB],
        tmpLocal,
      );
      controller.poke(tmpLocal);
    };

    const onDown = (e: PointerEvent) => {
      renderer.domElement.style.cursor = "grabbing";
      downX = e.clientX;
      downY = e.clientY;
      downTime = performance.now();
    };
    const onUp = (e: PointerEvent) => {
      renderer.domElement.style.cursor = "grab";
      const dx = e.clientX - downX;
      const dy = e.clientY - downY;
      const dt = performance.now() - downTime;
      if (dt <= CLICK_MAX_MS && dx * dx + dy * dy <= CLICK_MAX_PX_SQ) {
        handleClick(e.clientX, e.clientY);
      }
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
      scene.remove(body.object);
      body.dispose();
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
      aria-label="3D sporting equipment morpher — drag to rotate, click to ripple the surface"
    />
  );
}
