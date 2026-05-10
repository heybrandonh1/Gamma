"use client";

import { useEffect, useRef, useState } from "react";
import * as THREE from "three";
import { FBXLoader } from "three/examples/jsm/loaders/FBXLoader.js";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";

import { findBone, disposeObject } from "./bone-utils";
import { buildPartyHat } from "./party-hat";
import { buildDiscoFloor } from "./disco-floor";
import { buildConfetti, type Confetti } from "./confetti";
import { buildDiscoBall, type DiscoBall } from "./disco-ball";
import { buildClubLights, type ClubLights } from "./club-lights";
import {
  createShowController,
  type ShowController,
} from "./show-controller";
import {
  createAnimationController,
  pickPrimaryClip,
  type AnimationController,
} from "./animation-controller";
import { VibeFallback } from "../_shared/vibe-fallback";

export interface DiscoDancerProps {
  /** URL of the Samba Dancing FBX (Mixamo rig). Host app serves from /public. */
  sambaUrl: string;
  /** Optional second clip; when provided, "break" mode crossfades to it. */
  breakdanceUrl?: string;
  /** When true, animation, swap timer and floor shimmer all pause. */
  reduceMotion?: boolean | null;
  /**
   * When true, the dancer never leaves the samba loop — the periodic break
   * burst (clip crossfade in FBX mode, or root spin + speed-up + forward tilt
   * in procedural mode) is suppressed entirely. Use this when the surrounding
   * page wants a calmer, predictable loop and not the periodic flourish.
   */
  disableBreaks?: boolean;
  /** CSS aspect-ratio for the canvas wrapper. Defaults to "1 / 0.72". */
  aspectRatio?: string;
  /** Extra classes merged onto the canvas wrapper. */
  className?: string;
}

const LOOK_AT = new THREE.Vector3(0, 100, 0);

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

export function DiscoDancer({
  sambaUrl,
  breakdanceUrl,
  reduceMotion,
  disableBreaks = false,
  aspectRatio = "1 / 0.72",
  className,
}: DiscoDancerProps) {
  const mountRef = useRef<HTMLDivElement>(null);
  const reduceMotionRef = useRef(reduceMotion ?? false);
  const controllerRef = useRef<AnimationController | null>(null);
  const showRef = useRef<ShowController | null>(null);
  const loadGenerationRef = useRef(0);
  const [failed, setFailed] = useState(false);

  reduceMotionRef.current = reduceMotion ?? false;

  // Push the latest reduceMotion value into the controllers without a re-mount.
  useEffect(() => {
    controllerRef.current?.setReducedMotion(reduceMotion ?? false);
    showRef.current?.setReducedMotion(reduceMotion ?? false);
  }, [reduceMotion]);

  useEffect(() => {
    const mount = mountRef.current;
    if (!mount) return;

    if (!hasWebGL()) {
      setFailed(true);
      return;
    }

    const loadGeneration = ++loadGenerationRef.current;
    let alive = true;
    let raf = 0;
    let mixer: THREE.AnimationMixer | null = null;
    let root: THREE.Group | null = null;
    let hatDispose: (() => void) | null = null;
    let floorDispose: (() => void) | null = null;
    let floorUpdate: ((elapsed: number, paused?: boolean) => void) | null = null;
    let confetti: Confetti | null = null;
    let ball: DiscoBall | null = null;
    let lights: ClubLights | null = null;

    const scene = new THREE.Scene();

    // Tuned for the new light card background — softer ambient + a
    // half-strength key light so the colored club spots stay readable
    // against the page bg without washing out.
    const hemiLight = new THREE.HemisphereLight(0xffffff, 0xbcbcbc, 2.0);
    hemiLight.position.set(0, 200, 0);
    scene.add(hemiLight);

    const dirLight = new THREE.DirectionalLight(0xffffff, 1.8);
    dirLight.position.set(0, 200, 100);
    dirLight.castShadow = true;
    dirLight.shadow.camera.top = 180;
    dirLight.shadow.camera.bottom = -100;
    dirLight.shadow.camera.left = -120;
    dirLight.shadow.camera.right = 120;
    scene.add(dirLight);

    // Disco floor (replaces the plain ground from the original samba scene).
    const floor = buildDiscoFloor();
    scene.add(floor.group);
    floorUpdate = floor.update;
    floorDispose = floor.dispose;

    const clock = new THREE.Clock();
    const camera = new THREE.PerspectiveCamera(45, 1, 1, 2000);
    camera.position.set(100, 200, 300);
    camera.lookAt(LOOK_AT);

    let renderer: THREE.WebGLRenderer;
    try {
      renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    } catch (err) {
      console.error("[disco-dancer] WebGL init failed:", err);
      setFailed(true);
      return;
    }
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.shadowMap.enabled = true;
    // ACES Filmic keeps the saturated palette readable against the light
    // card bg — unmapped colors clip and wash out.
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.0;
    renderer.setClearColor(0x000000, 0);

    // Confetti, disco ball, club lights — driven by the show controller below.
    confetti = buildConfetti();
    scene.add(confetti.group);

    ball = buildDiscoBall(renderer);
    scene.add(ball.group);

    lights = buildClubLights();
    scene.add(lights.group);

    showRef.current = createShowController({ confetti, ball, lights });
    showRef.current.setReducedMotion(reduceMotionRef.current);

    const resize = () => {
      const w = Math.max(280, mount.clientWidth || 400);
      const h = Math.max(280, Math.min(520, Math.round(w * 0.72)));
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
      renderer.setSize(w, h);
    };

    mount.appendChild(renderer.domElement);
    resize();

    const ro = new ResizeObserver(resize);
    ro.observe(mount);

    const controls = new OrbitControls(camera, renderer.domElement);
    controls.target.copy(LOOK_AT);
    controls.enableDamping = true;
    controls.dampingFactor = 0.08;
    controls.minDistance = 120;
    controls.maxDistance = 900;
    controls.update();

    renderer.domElement.style.touchAction = "none";
    renderer.domElement.style.cursor = "grab";

    type Jump = { start: number; duration: number; height: number };
    let jump: Jump | null = null;

    // Jelly wobble: a damped cartoon squash-and-stretch applied to the FBX
    // root group's scale on click. Y squashes (cos starts at 1 = peak
    // squash on impact), X / Z bulge outward to fake volume preservation,
    // and a secondary out-of-phase term on Z gives the dancer that
    // "wobbling jelly bean" character. Re-clicking refreshes the wobble.
    type Jelly = { start: number; amp: number };
    let jelly: Jelly | null = null;
    const JELLY_AMP = 0.22;
    const JELLY_DECAY = 2.0;
    const JELLY_FREQ_Y = 8.5;
    const JELLY_FREQ_Z = 11.0;
    const JELLY_REST = 0.0025;

    const onDown = () => {
      renderer.domElement.style.cursor = "grabbing";
    };
    const onUp = () => {
      renderer.domElement.style.cursor = "grab";
    };
    const onClick = () => {
      if (!root || reduceMotionRef.current) return;
      // Jump is one-shot per cycle; jelly always resets on a fresh click
      // so spam-clicking keeps the body wobbling.
      if (!jump) jump = { start: performance.now(), duration: 750, height: 120 };
      jelly = { start: performance.now(), amp: JELLY_AMP };
    };

    renderer.domElement.addEventListener("pointerdown", onDown);
    renderer.domElement.addEventListener("click", onClick);
    window.addEventListener("pointerup", onUp);

    const loader = new FBXLoader();

    loader.load(
      sambaUrl,
      (sambaObject) => {
        if (!alive || loadGeneration !== loadGenerationRef.current) {
          disposeObject(sambaObject);
          return;
        }

        if (root) {
          scene.remove(root);
          disposeObject(root);
        }

        root = sambaObject;
        sambaObject.scale.setScalar(1);

        sambaObject.traverse((child) => {
          if ((child as THREE.Mesh).isMesh) {
            (child as THREE.Mesh).castShadow = true;
            (child as THREE.Mesh).receiveShadow = true;
          }
        });

        const sambaClip = pickPrimaryClip(sambaObject.animations);
        if (!sambaClip) {
          console.warn("[disco-dancer] samba FBX has no animation clips");
          scene.add(sambaObject);
          return;
        }

        mixer = new THREE.AnimationMixer(sambaObject);
        const sambaAction = mixer.clipAction(sambaClip);
        sambaAction.play();

        const finishSetup = (breakAction: THREE.AnimationAction | null) => {
          controllerRef.current = createAnimationController({
            root: sambaObject,
            sambaAction,
            breakAction,
          });
          controllerRef.current.setReducedMotion(reduceMotionRef.current);
        };

        if (disableBreaks) {
          // Caller wants a samba-only loop — skip the swap controller entirely
          // so the mixer just keeps playing the already-`.play()`-ed samba
          // action forever, with no procedural overlay or clip crossfade.
        } else if (breakdanceUrl) {
          // Load the breakdance clip onto the same mixer/skeleton.
          new FBXLoader().load(
            breakdanceUrl,
            (breakObject) => {
              if (!alive || loadGeneration !== loadGenerationRef.current) {
                disposeObject(breakObject);
                return;
              }
              const breakClip = pickPrimaryClip(breakObject.animations);
              if (!breakClip || !mixer) {
                finishSetup(null);
                disposeObject(breakObject);
                return;
              }
              const breakAction = mixer.clipAction(breakClip);
              finishSetup(breakAction);
              // We only needed the clip; the mesh stays unused.
              disposeObject(breakObject);
            },
            undefined,
            (err) => {
              console.warn("[disco-dancer] breakdance FBX failed; falling back to procedural:", err);
              finishSetup(null);
            },
          );
        } else {
          finishSetup(null);
        }

        // Party hat — parented to head bone with a small upward offset.
        const head = findBone(sambaObject, /Head$/i);
        if (head) {
          const { group: hat, dispose } = buildPartyHat();
          hatDispose = dispose;
          // Mixamo head bone +Y points up the skull, so the hat sits cleanly.
          hat.position.set(0, 14, 2);
          hat.rotation.x = -0.05;
          head.add(hat);
        }

        scene.add(sambaObject);
      },
      undefined,
      (err) => {
        console.warn("[disco-dancer] samba FBX failed to load:", err);
      },
    );

    const tick = () => {
      if (!alive) return;
      raf = requestAnimationFrame(tick);
      const delta = clock.getDelta();
      const elapsed = clock.getElapsedTime();
      const now = performance.now();

      if (mixer && !reduceMotionRef.current) mixer.update(delta);
      controllerRef.current?.update(now);
      floorUpdate?.(elapsed, reduceMotionRef.current);
      confetti?.update(delta, reduceMotionRef.current);
      ball?.update(delta, reduceMotionRef.current);
      lights?.update(delta, elapsed, reduceMotionRef.current);
      showRef.current?.update(now);

      if (root) {
        if (jump) {
          const t = (performance.now() - jump.start) / jump.duration;
          if (t >= 1) {
            root.position.y = 0;
            jump = null;
          } else {
            root.position.y = Math.sin(Math.PI * t) * jump.height;
          }
        } else {
          root.position.y = 0;
        }

        // Cartoon jelly squash on click — independent channel from the
        // jump (position.y), so they happily co-exist on the same frame.
        if (jelly) {
          const dt = (now - jelly.start) / 1000;
          const peakNow = jelly.amp * Math.exp(-dt * JELLY_DECAY);
          if (peakNow < JELLY_REST) {
            root.scale.set(1, 1, 1);
            jelly = null;
          } else {
            // cos at t=0 = 1 ⇒ Y is at maximum squash, X / Z at max bulge.
            const ySquash = peakNow * Math.cos(dt * JELLY_FREQ_Y);
            const lateralBulge = peakNow * 0.55 * Math.cos(dt * JELLY_FREQ_Y);
            // Z drifts on a slightly different frequency so the wobble
            // goes out of phase over time — that's what makes a real
            // jelly look "alive" rather than mechanically symmetric.
            const zAsym = peakNow * 0.18 * Math.cos(dt * JELLY_FREQ_Z);
            root.scale.set(
              1 + lateralBulge + zAsym,
              1 - ySquash,
              1 + lateralBulge - zAsym,
            );
          }
        } else {
          root.scale.set(1, 1, 1);
        }
      }

      controls.update();
      renderer.render(scene, camera);
    };
    tick();

    return () => {
      alive = false;
      cancelAnimationFrame(raf);
      ro.disconnect();
      controls.dispose();
      renderer.domElement.removeEventListener("pointerdown", onDown);
      renderer.domElement.removeEventListener("click", onClick);
      window.removeEventListener("pointerup", onUp);
      controllerRef.current?.dispose();
      controllerRef.current = null;
      showRef.current?.dispose();
      showRef.current = null;
      if (root) {
        scene.remove(root);
        disposeObject(root);
        root = null;
      }
      hatDispose?.();
      hatDispose = null;
      floorDispose?.();
      floorDispose = null;
      floorUpdate = null;
      if (confetti) {
        scene.remove(confetti.group);
        confetti.dispose();
        confetti = null;
      }
      if (ball) {
        scene.remove(ball.group);
        ball.dispose();
        ball = null;
      }
      if (lights) {
        scene.remove(lights.group);
        lights.dispose();
        lights = null;
      }
      mixer = null;
      renderer.dispose();
      if (renderer.domElement.parentNode === mount) {
        mount.removeChild(renderer.domElement);
      }
    };
    // We deliberately don't list reduceMotion in deps — it's pulled through
    // reduceMotionRef so toggling it doesn't tear down the scene.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sambaUrl, breakdanceUrl, disableBreaks]);

  if (failed) return <VibeFallback aspectRatio={aspectRatio} className={className} />;

  return (
    <div
      ref={mountRef}
      className={
        "relative w-full overflow-hidden rounded-xl border border-foreground/10 " +
        "bg-[color-mix(in_srgb,var(--color-background)_92%,#a0a0a0)] " +
        "shadow-[0_20px_50px_-24px_rgba(0,0,0,0.35)] " +
        "dark:bg-[color-mix(in_srgb,var(--color-background)_88%,#555)] " +
        (className ?? "")
      }
      style={{ aspectRatio }}
      aria-hidden
    />
  );
}
