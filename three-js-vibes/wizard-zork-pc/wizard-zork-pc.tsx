"use client";

import { useEffect, useRef, useState } from "react";
import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { RoomEnvironment } from "three/examples/jsm/environments/RoomEnvironment.js";
import { EffectComposer } from "three/examples/jsm/postprocessing/EffectComposer.js";
import { RenderPass } from "three/examples/jsm/postprocessing/RenderPass.js";
import { UnrealBloomPass } from "three/examples/jsm/postprocessing/UnrealBloomPass.js";
import { OutputPass } from "three/examples/jsm/postprocessing/OutputPass.js";

import { createCandles } from "./candles";
import { createCrtScreen } from "./crt-screen";
import { createCrystalOrb } from "./crystal-orb";
import { createGhostYear } from "./ghost-year";
import { createInputController } from "./input-controller";
import { createMagicParticles } from "./magic-particles";
import { createPc } from "./pc-chassis";
import { createPeripherals } from "./peripherals";
import { createShowController } from "./show-controller";
import { createTerminalBuffer } from "./terminal-buffer";
import { createWizardTable } from "./wizard-table";
import {
  VibeFallback,
  attachRenderVisibility,
  createFpsThrottle,
} from "../_shared";

/**
 * Wizard's Zork PC vibe — a beige CRT on a magical wood table runs
 * Zork I in amber phosphor while runes pulse, candles flicker, a
 * transmissive crystal orb spins on the corner, and a beige keyboard
 * and mouse sit in front of the monitor with the mouse cable plugged
 * into the tower.
 *
 * The component owns its renderer, scene, post-processing composer,
 * orbit controls, all subsystem controllers, and the hidden input
 * element — disposes everything on unmount, the same contract as the
 * other vibes in this package.
 *
 * Three.js examples this leans on (referenced inline in each
 * subsystem's source):
 *   - `webgl_postprocessing_unreal_bloom` (UnrealBloomPass for the CRT
 *     phosphor glow + candle/orb highlights)
 *   - `webgl_materials_physical_transmission` (the orb's glass)
 *   - `webgl_points_sprites` (additive ember/dust particles)
 *   - `misc_controls_orbit` (rotate-only damped camera)
 *   - `RoomEnvironment` for IBL fill (same as sport-ball-morpher)
 */

export interface WizardZorkPcProps {
  /** Pause animations and pin the show at its first frame. */
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
      canvas.getContext("webgl2") ||
      canvas.getContext("webgl") ||
      canvas.getContext("experimental-webgl");
    return !!gl;
  } catch {
    return false;
  }
}

export function WizardZorkPc({
  reduceMotion,
  aspectRatio = "1 / 0.72",
  className,
}: WizardZorkPcProps) {
  const mountRef = useRef<HTMLDivElement>(null);
  const reduceMotionRef = useRef(reduceMotion ?? false);
  const setReducedRef = useRef<((v: boolean) => void) | null>(null);
  const [failed, setFailed] = useState(false);

  reduceMotionRef.current = reduceMotion ?? false;

  useEffect(() => {
    setReducedRef.current?.(reduceMotion ?? false);
  }, [reduceMotion]);

  useEffect(() => {
    const mount = mountRef.current;
    if (!mount) return;

    if (!hasWebGL()) {
      setFailed(true);
      return;
    }

    // See render-loop.ts — pauses the loop when off-screen or tab hidden.
    const visibility = attachRenderVisibility(mount);
    // Decorative — 30fps is plenty for the candles / particles / orb / CRT
    // glow loop, and halves the bloom + composer cost.
    const fpsGate = createFpsThrottle(30);

    let alive = true;
    let raf = 0;

    // ----- renderer -------------------------------------------------------
    let renderer: THREE.WebGLRenderer;
    try {
      renderer = new THREE.WebGLRenderer({
        antialias: true,
        alpha: false,
        powerPreference: "high-performance",
      });
    } catch (err) {
      console.error("[wizard-zork-pc] WebGL init failed:", err);
      setFailed(true);
      return;
    }
    // Cap at 1.5 instead of 2 to cut fragment-shader cost on retina (~44% drop).
    // EffectComposer below picks up `renderer.getPixelRatio()` so the bloom +
    // CRT passes match automatically.
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5));
    renderer.setClearColor(0x06030a, 1);
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.05;

    // ----- scene ---------------------------------------------------------
    const scene = new THREE.Scene();
    scene.background = new THREE.Color("#06030a");
    const fogColor = new THREE.Color("#0a0612");
    scene.fog = new THREE.Fog(fogColor, 8, 22);

    const camera = new THREE.PerspectiveCamera(34, 1, 0.1, 100);
    camera.position.set(2.4, 2.6, 5.6);
    camera.lookAt(0, 1.0, 0);

    // PMREM RoomEnvironment — same IBL fill as sport-ball-morpher.
    const pmrem = new THREE.PMREMGenerator(renderer);
    const envTexture = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
    scene.environment = envTexture;

    // Soft ambient + a cool key from above so the wood reads even when
    // the candles are between flickers.
    const ambient = new THREE.AmbientLight(0x8870ff, 0.18);
    scene.add(ambient);
    const cool = new THREE.DirectionalLight(0xb6c8ff, 0.18);
    cool.position.set(-3, 6, -1);
    scene.add(cool);

    // ----- subsystems ----------------------------------------------------
    const table = createWizardTable();
    scene.add(table.object);

    const pc = createPc();
    pc.object.position.set(-0.4, table.topY + 0.15, -0.6);
    pc.object.rotation.y = Math.PI * 0.05;
    scene.add(pc.object);

    // Keyboard + mouse + cable, parented to the PC group so they
    // inherit the chassis's small yaw and the desk reads as one
    // assembled set rather than three pieces dropped at world origin.
    const peripherals = createPeripherals({
      tableY: 0,
      towerCablePort: pc.towerCablePort,
    });
    pc.object.add(peripherals.object);

    const buffer = createTerminalBuffer();
    const screen = createCrtScreen({
      texture: buffer.texture,
      width: pc.screenWidth,
      height: pc.screenHeight,
    });
    pc.object.add(screen.mesh);
    screen.mesh.position.copy(pc.screenAnchor);
    // Plane normal already faces +Z; the chassis is rotated, so the
    // screen rides along.

    const candles = createCandles({
      positions: [
        new THREE.Vector3(2.1, table.topY + 0.0, 0.9),
        new THREE.Vector3(-2.4, table.topY + 0.0, 0.5),
      ],
    });
    scene.add(candles.object);

    const orb = createCrystalOrb({
      position: new THREE.Vector3(2.6, table.topY + 0.4, -1.4),
      radius: 0.36,
    });
    scene.add(orb.object);

    const particles = createMagicParticles({
      emberOrigin: new THREE.Vector3(0, table.topY + 0.4, 0.4),
      dustOrigin: new THREE.Vector3(2.4, table.topY + 1.2, -1.2),
    });
    scene.add(particles.object);

    // "1978" backdrop — massive ghostly digits that materialise one at
    // a time behind the table, hold while the year is fully spelled,
    // then dissolve away one at a time. Sits inside the scene's fog
    // band so it reads as a memory rather than a sign.
    const ghostYear = createGhostYear({
      year: "1978",
      center: new THREE.Vector3(0, 2.6, -7.5),
      digitHeight: 4.6,
      digitSpacing: 0.78,
      cycleSeconds: 14,
    });
    scene.add(ghostYear.object);

    // ----- post-processing ----------------------------------------------
    // Bloom is what sells the magical CRT — without it the screen looks
    // like a flat decal. With it, the bright phosphor / candles / orb
    // light bleeds into the scene the way it would on real glass.
    //
    // Tuned for *text legibility first*: a high threshold (0.85) so only
    // the brightest pixels (flame tips, prompt caret, rune peaks)
    // bloom; modest strength (0.22) and tight radius (0.35) so the
    // halo doesn't wash over the terminal text the user is trying to
    // read. Earlier values (0.55 / 0.7 / 0.6) blew the whole scene out.
    const composer = new EffectComposer(renderer);
    composer.setPixelRatio(renderer.getPixelRatio());
    composer.addPass(new RenderPass(scene, camera));
    const bloom = new UnrealBloomPass(new THREE.Vector2(1, 1), 0.22, 0.35, 0.85);
    composer.addPass(bloom);
    composer.addPass(new OutputPass());

    // ----- show + input controllers --------------------------------------
    const show = createShowController({ buffer, screen });
    const input = createInputController({ controller: show });

    show.setReducedMotion(reduceMotionRef.current);
    [table, candles, orb, particles, pc, peripherals, screen, ghostYear].forEach(
      (sys) => sys.setReducedMotion(reduceMotionRef.current),
    );

    // ----- mount + resize -----------------------------------------------
    mount.appendChild(renderer.domElement);
    renderer.domElement.style.cursor = "text";
    renderer.domElement.style.touchAction = "none";

    const resize = () => {
      const w = Math.max(280, mount.clientWidth || 400);
      const h = Math.max(280, Math.round(w * 0.72));
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
      renderer.setSize(w, h);
      composer.setSize(w, h);
      bloom.setSize(w, h);
    };
    resize();
    const ro = new ResizeObserver(resize);
    ro.observe(mount);

    // ----- camera controls ----------------------------------------------
    // OrbitControls computes the camera position from spherical coordinates
    // around `target` each `update()`, so setting `camera.position`
    // ourselves would fight it. The slow drift we want is exactly what
    // `autoRotate` does — it advances the azimuthal angle and pauses
    // briefly while the user drags. Suppressed under reduceMotion.
    //
    // Zoom is enabled (unlike the other vibes) because reading the
    // CRT terminal is the whole point — a static distant view would
    // never be legible. `minDistance` parks the camera close enough
    // that the screen fills most of the frame; `maxDistance` keeps
    // visitors from zooming out into empty space. `zoomSpeed` is
    // dampened so a single trackpad nudge doesn't punt the camera
    // across the whole range.
    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.08;
    controls.enableZoom = true;
    controls.zoomSpeed = 0.6;
    controls.minDistance = 2.2;
    controls.maxDistance = 9.0;
    controls.enablePan = false;
    controls.rotateSpeed = 0.55;
    controls.target.set(0, 1.0, 0);
    controls.minPolarAngle = Math.PI * 0.18;
    controls.maxPolarAngle = Math.PI * 0.55;
    controls.autoRotate = !reduceMotionRef.current;
    controls.autoRotateSpeed = 0.35;

    // Wire reduce-motion late so it can flip OrbitControls' autoRotate
    // alongside the subsystem freezes. Set after `controls` is declared
    // so the closure isn't capturing a TDZ binding.
    setReducedRef.current = (v: boolean) => {
      show.setReducedMotion(v);
      [table, candles, orb, particles, pc, peripherals, screen, ghostYear].forEach(
        (sys) => sys.setReducedMotion(v),
      );
      controls.autoRotate = !v;
    };

    // ----- hidden input wiring ------------------------------------------
    const detachInput = input.attachToCanvas(renderer.domElement);

    // ----- start the show ------------------------------------------------
    show.start();

    // ----- animation loop -----------------------------------------------
    const clock = new THREE.Clock();

    const tick = () => {
      if (!alive) return;
      raf = requestAnimationFrame(tick);
      // Off-screen / hidden tab → skip the work.
      if (!visibility.visibleRef.current) return;
      // 30fps gate for the decorative cadence.
      if (!fpsGate.shouldRender(performance.now())) return;
      const delta = clock.getDelta();

      table.tick(delta);
      candles.tick(delta);
      orb.tick(delta);
      particles.tick(delta);
      pc.tick(delta);
      peripherals.tick(delta);
      screen.tick(delta);
      buffer.tick(delta);
      ghostYear.tick(delta);

      // Auto-orbit is OrbitControls' own `autoRotate` (toggled by the
      // reduce-motion handler above) — no manual camera nudges needed.
      controls.update();
      composer.render(delta);
    };
    raf = requestAnimationFrame(tick);

    return () => {
      alive = false;
      cancelAnimationFrame(raf);
      visibility.dispose();
      ro.disconnect();
      detachInput();
      controls.dispose();
      show.dispose();
      input.dispose();

      buffer.dispose();
      screen.dispose();
      peripherals.dispose();
      pc.dispose();
      table.dispose();
      candles.dispose();
      orb.dispose();
      particles.dispose();
      ghostYear.dispose();

      composer.dispose();
      bloom.dispose();
      scene.environment = null;
      envTexture.dispose();
      pmrem.dispose();
      renderer.dispose();
      if (renderer.domElement.parentNode === mount) {
        mount.removeChild(renderer.domElement);
      }
      setReducedRef.current = null;
    };
  }, []);

  if (failed) return <VibeFallback aspectRatio={aspectRatio} className={className} />;

  return (
    <div
      ref={mountRef}
      className={
        "relative w-full overflow-hidden rounded-xl border border-foreground/10 " +
        "shadow-[0_20px_50px_-24px_rgba(0,0,0,0.65)] " +
        (className ?? "")
      }
      style={{
        aspectRatio,
        backgroundColor: "#06030a",
        backgroundImage:
          "radial-gradient(ellipse at center, #1a0e1f 0%, #06030a 70%, #02010a 100%)",
      }}
      role="img"
      aria-label="A wizard's table with a beige CRT running Zork I in amber phosphor — drag to rotate, click and type to play"
    />
  );
}
