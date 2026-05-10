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

    // ---- cursor → body-surface projection ----------------------------
    //
    // The body's `geometry.position` attribute is the rest unit sphere
    // (the morph happens in the shader), so the cheapest way to find
    // where the cursor "lives on the body" is to intersect the camera
    // ray with that unit sphere in body-local space, then project the
    // resulting unit direction onto the *current morphed* surface
    // using `morphedSurfacePoint` (a CPU mirror of the same blend the
    // vertex shader runs).
    //
    // Hover is re-projected on every animation frame, not just on
    // pointermove, because the body auto-spins. If we cached the local
    // hit point at pointermove time, the body would rotate beneath
    // the cursor and the wave would visibly slide across the surface
    // instead of staying anchored to wherever the cursor currently
    // points. Per-frame ray-sphere intersection is ~10 floating-point
    // ops, so this is essentially free.
    const CLICK_MAX_PX_SQ = 36;
    const CLICK_MAX_MS = 350;
    const raycaster = new THREE.Raycaster();
    const ndc = new THREE.Vector2();
    const restSphere = new THREE.Sphere(new THREE.Vector3(0, 0, 0), 1);
    const tmpInvMat = new THREE.Matrix4();
    const tmpLocalRay = new THREE.Ray();
    const tmpLocalHit = new THREE.Vector3();
    const tmpDir = new THREE.Vector3();
    const tmpProjected = new THREE.Vector3();

    let hoverScreenActive = false;
    let hoverClientX = 0;
    let hoverClientY = 0;
    let downX = 0;
    let downY = 0;
    let downTime = 0;

    /**
     * Intersect the camera's pick ray with the body's rest unit
     * sphere, in body-local coordinates. Returns the local hit point
     * or `null` if the cursor is over empty canvas.
     *
     * Working in the body's local space is what makes this stable
     * under auto-spin: the body's matrix world is what's changing,
     * so we transform the ray into local space and then test against
     * a stationary unit sphere.
     */
    const projectCursorToBodyLocal = (
      clientX: number,
      clientY: number,
    ): THREE.Vector3 | null => {
      const rect = renderer.domElement.getBoundingClientRect();
      ndc.set(
        ((clientX - rect.left) / rect.width) * 2 - 1,
        -((clientY - rect.top) / rect.height) * 2 + 1,
      );
      raycaster.setFromCamera(ndc, camera);
      body.object.updateMatrixWorld();
      tmpInvMat.copy(body.object.matrixWorld).invert();
      tmpLocalRay.copy(raycaster.ray).applyMatrix4(tmpInvMat);
      const hit = tmpLocalRay.intersectSphere(restSphere, tmpLocalHit);
      return hit;
    };

    /**
     * Project a body-local rest-sphere hit onto the *current* morphed
     * surface, so the wave radiates from where the user actually
     * pointed even mid-morph (the rest sphere is at radius 1, but the
     * visible silhouette might be 0.7 for a basketball or 1.4 for a
     * football tip).
     */
    const localToMorphed = (localHit: THREE.Vector3): THREE.Vector3 => {
      tmpDir.copy(localHit).normalize();
      const blendInfo = controller.currentBlend();
      morphedSurfacePoint(
        tmpDir,
        blendInfo.blend,
        SPORT_SPECS[blendInfo.slotA],
        SPORT_SPECS[blendInfo.slotB],
        tmpProjected,
      );
      return tmpProjected;
    };

    const handleClick = (clientX: number, clientY: number) => {
      const local = projectCursorToBodyLocal(clientX, clientY);
      if (!local) return;
      controller.poke(localToMorphed(local));
    };

    const onPointerMove = (e: PointerEvent) => {
      hoverScreenActive = true;
      hoverClientX = e.clientX;
      hoverClientY = e.clientY;
    };
    const onPointerLeave = () => {
      hoverScreenActive = false;
      controller.releaseHover();
    };
    const onPointerEnter = (e: PointerEvent) => {
      // Cover the case where the pointer enters the canvas mid-drag
      // (e.g. flicked in from outside). `enter` doesn't fire for
      // touch but pointermove does, so we cover both surfaces.
      hoverScreenActive = true;
      hoverClientX = e.clientX;
      hoverClientY = e.clientY;
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
    renderer.domElement.addEventListener("pointermove", onPointerMove);
    renderer.domElement.addEventListener("pointerleave", onPointerLeave);
    renderer.domElement.addEventListener("pointerenter", onPointerEnter);
    renderer.domElement.addEventListener("pointerdown", onDown);
    window.addEventListener("pointerup", onUp);

    const clock = new THREE.Clock();

    const tick = () => {
      if (!alive) return;
      raf = requestAnimationFrame(tick);
      const delta = clock.getDelta();

      if (!reduceMotionRef.current) controller.update(delta);
      controls.update();

      // Per-frame hover projection. Re-tests the cursor's last screen
      // position against the body each frame so the wave center
      // stays under the cursor even while the body spins. If the
      // cursor missed the body this frame (e.g. user moved into
      // empty canvas without pointerleave firing — common during
      // OrbitControls drag at the edge), release the hold so the
      // wave decays out naturally.
      if (hoverScreenActive) {
        const local = projectCursorToBodyLocal(hoverClientX, hoverClientY);
        if (local) {
          controller.hold(localToMorphed(local));
        } else {
          controller.releaseHover();
        }
      }

      renderer.render(scene, camera);
    };
    raf = requestAnimationFrame(tick);

    return () => {
      alive = false;
      cancelAnimationFrame(raf);
      ro.disconnect();
      controls.dispose();
      renderer.domElement.removeEventListener("pointermove", onPointerMove);
      renderer.domElement.removeEventListener("pointerleave", onPointerLeave);
      renderer.domElement.removeEventListener("pointerenter", onPointerEnter);
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
        backgroundColor: "#ffffff",
      }}
      role="img"
      aria-label="3D sporting equipment morpher — drag to rotate, hover to ripple, click to splash the surface"
    />
  );
}
