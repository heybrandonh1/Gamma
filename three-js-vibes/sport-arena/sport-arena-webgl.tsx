"use client";

import { useEffect, useRef, useState } from "react";
import * as THREE from "three";
import { RoomEnvironment } from "three/examples/jsm/environments/RoomEnvironment.js";
import { World, type Body } from "@perplexdotgg/bounce";

import {
  buildAllSportBallSpecs,
  disposeSportBallSpec,
  type SportBallSpec,
} from "./sport-balls";
import { buildMannequin, type Mannequin } from "./mannequin";
import { VibeFallback } from "../_shared/vibe-fallback";

/**
 * SportArenaWebGL — the WebGL companion to {@link SportArena}.
 *
 * Same physics simulation as the WebGPU SSGI version (same wall set, same
 * Bounce world, same five sport-ball families, same compound-shape
 * mannequin, same pointer-push + respawn behavior). The only thing that
 * changes is the rendering path:
 *
 *   - WebGPU: MRT pass → SSGI (indirect lighting + AO) → TRAA composite,
 *     all driven by `THREE.RenderPipeline`.
 *   - WebGL (this file): plain `THREE.WebGLRenderer.render(scene, camera)`
 *     with an IBL probe (procedural `RoomEnvironment` baked through
 *     `PMREMGenerator`) standing in for the missing screen-space GI plus
 *     a few extra direct lights to compensate for the lost bounce energy.
 *
 * The shared sport-ball builders (`sport-balls.ts`) and `buildMannequin`
 * (`mannequin.ts`) both already use plain `three` (not `three/webgpu`), so
 * they drop in as-is — only the renderer + post pipeline differ.
 *
 * If WebGL itself is unavailable (or `WebGLRenderer` throws on init), the
 * component renders the shared `VibeFallback` square so the playground
 * card always occupies the same footprint regardless of GPU support.
 */

export interface SportArenaWebGLProps {
  reduceMotion?: boolean | null;
  aspectRatio?: string;
  className?: string;
}

const BALL_RADIUS_HINT = 0.42;
const BOX_HEIGHT = 6;
const BOX_DEPTH = 8;
const WALL_THICKNESS = 0.5;
const CAM_FOV = 45;
const EASE_SPEED = 8;
const PUSH_RADIUS = 1.6;
const PUSH_STRENGTH = 14;

// Ball counts per type. Identical to the WebGPU version so visual parity
// holds when the user's browser silently downgrades from one to the other.
const BALL_COUNTS: Record<string, number> = {
  basketball: 8,
  soccer: 10,
  football: 10,
  baseball: 18,
  "hockey-puck": 14,
};

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

export function SportArenaWebGL({
  reduceMotion,
  aspectRatio = "1 / 0.72",
  className,
}: SportArenaWebGLProps) {
  const mountRef = useRef<HTMLDivElement>(null);
  const reduceMotionRef = useRef(reduceMotion ?? false);
  const [failed, setFailed] = useState(false);

  reduceMotionRef.current = reduceMotion ?? false;

  useEffect(() => {
    const mount = mountRef.current;
    if (!mount) return;

    if (!hasWebGL()) {
      setFailed(true);
      return;
    }

    let alive = true;
    let raf = 0;
    // Track every disposable we own so cleanup is exhaustive even when
    // init fails partway through. Mirrors the cleanup pattern used by the
    // WebGPU sibling.
    const owned: { dispose(): void }[] = [];
    let disposed = false;

    let renderer: THREE.WebGLRenderer | null = null;
    let resizeObserver: ResizeObserver | null = null;
    let removePointerListeners: (() => void) | null = null;

    const cleanup = () => {
      if (disposed) return;
      disposed = true;
      alive = false;
      cancelAnimationFrame(raf);
      resizeObserver?.disconnect();
      removePointerListeners?.();
      for (const item of owned) {
        try {
          item.dispose();
        } catch (err) {
          console.warn("[sport-arena-webgl] dispose failed:", err);
        }
      }
      if (renderer) {
        if (renderer.domElement.parentNode === mount) {
          mount.removeChild(renderer.domElement);
        }
        renderer.dispose();
        renderer = null;
      }
    };

    try {
      const camera = new THREE.PerspectiveCamera(CAM_FOV, 1, 0.1, 100);
      const scene = new THREE.Scene();

      try {
        renderer = new THREE.WebGLRenderer({
          antialias: true,
          alpha: false,
          powerPreference: "high-performance",
        });
      } catch (err) {
        console.error("[sport-arena-webgl] WebGL init failed:", err);
        setFailed(true);
        return;
      }

      renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
      renderer.setClearColor(0xeeeeee, 1);
      renderer.toneMapping = THREE.ACESFilmicToneMapping;
      // SSGI's GI pass roughly doubles the room's luminance via colored
      // bounces. Without it, exposure 0.5 (the WebGPU value) reads as
      // muddy; bumping to ~1.0 plus the extra direct lights below
      // recovers the same overall brightness without blowing out the
      // white walls.
      renderer.toneMappingExposure = 1.0;
      renderer.shadowMap.enabled = true;
      renderer.shadowMap.type = THREE.PCFSoftShadowMap;

      mount.appendChild(renderer.domElement);

      // ---- IBL probe -----------------------------------------------------
      // PMREM-baked procedural studio room — same trick as Sport Ball
      // Morpher. This is the single biggest contributor to "the materials
      // look physical": MeshPhysicalMaterial picks up reflections /
      // image-based lighting on its rough surfaces, which is roughly the
      // role SSGI's indirect lighting plays in the WebGPU pipeline.
      const pmrem = new THREE.PMREMGenerator(renderer);
      const envTexture = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
      scene.environment = envTexture;
      owned.push({
        dispose: () => {
          envTexture.dispose();
          pmrem.dispose();
          scene.environment = null;
        },
      });

      // ---- direct lighting (compensates for missing GI bounces) ---------
      // Hemisphere + ambient give the underside of the mannequin and the
      // bottom hemispheres of the balls a tiny bit of fill so they don't
      // read as silhouettes against the white floor. The mouse-tracking
      // PointLight below is the only shadow caster — keeping it as the
      // single shadow source mirrors the WebGPU example's lighting setup.
      const hemi = new THREE.HemisphereLight(0xffffff, 0x999999, 0.6);
      hemi.position.set(0, BOX_HEIGHT, 0);
      scene.add(hemi);

      const ambient = new THREE.AmbientLight(0xffffff, 0.25);
      scene.add(ambient);

      const mouseLight = new THREE.PointLight(0xffffff, 80, 0, 1);
      mouseLight.position.set(0, BOX_HEIGHT / 2, BOX_DEPTH / 2);
      mouseLight.castShadow = true;
      mouseLight.shadow.mapSize.set(1024, 1024);
      mouseLight.shadow.radius = 12;
      mouseLight.shadow.bias = -0.0005;
      scene.add(mouseLight);

      // ---- raycaster + pointer state ------------------------------------
      const raycaster = new THREE.Raycaster();
      const pointer = new THREE.Vector2();

      const mouseRayOrigin = new THREE.Vector3();
      const mouseRayDir = new THREE.Vector3();
      const mouseRayOriginTarget = new THREE.Vector3();
      const mouseRayDirTarget = new THREE.Vector3();
      const mouseLightTarget = new THREE.Vector3(
        0,
        BOX_HEIGHT / 2,
        BOX_DEPTH / 2,
      );

      let mouseMoving = false;
      let mouseStopTimer: ReturnType<typeof setTimeout> | null = null;
      let pointerDown = false;
      const activePointers = new Set<number>();

      // ---- physics world ------------------------------------------------
      const world = new World({
        gravity: [0, -9.81, 0],
        solveVelocityIterations: 6,
        solvePositionIterations: 2,
        linearDamping: 0.1,
        angularDamping: 0.1,
        restitution: 0.4,
        friction: 0.5,
      });
      // Bounce's `World` has no explicit dispose — bodies/shapes are pool
      // reclaimed when the JS object goes out of scope. The placeholder
      // here keeps the cleanup pass uniform with the WebGPU version.
      owned.push({ dispose: () => void 0 });

      const boxSize = { w: 8, h: BOX_HEIGHT, d: BOX_DEPTH };

      const sportBallSpecs: SportBallSpec[] = buildAllSportBallSpecs();
      owned.push({
        dispose: () => sportBallSpecs.forEach(disposeSportBallSpec),
      });

      type BallType = {
        spec: SportBallSpec;
        mesh: THREE.InstancedMesh;
        bodies: Body[];
      };
      let ballTypes: BallType[] = [];

      let wallMeshes: THREE.Mesh[] = [];
      let mannequin: Mannequin | null = null;

      function getBoxWidth() {
        const aspect = camera.aspect || 1;
        const vFov = THREE.MathUtils.degToRad(CAM_FOV / 2);
        const dist = BOX_HEIGHT / 2 / Math.tan(vFov);
        return Math.tan(vFov) * aspect * dist * 2;
      }

      function fitCameraToBox() {
        const vFov = THREE.MathUtils.degToRad(CAM_FOV / 2);
        const dist = boxSize.h / 2 / Math.tan(vFov);
        camera.position.set(0, boxSize.h / 2, dist + boxSize.d / 2);
        camera.lookAt(0, boxSize.h / 2, 0);
        camera.updateProjectionMatrix();
      }

      function createBox() {
        const hw = boxSize.w / 2;
        const hh = boxSize.h / 2;
        const hd = boxSize.d / 2;
        const t = WALL_THICKNESS;

        const whiteMaterial = new THREE.MeshPhysicalMaterial({
          color: 0xeeeeee,
          roughness: 0.7,
          metalness: 0.0,
        });
        const redMaterial = new THREE.MeshPhysicalMaterial({
          color: 0xff2222,
          roughness: 0.7,
          metalness: 0.0,
        });
        const greenMaterial = new THREE.MeshPhysicalMaterial({
          color: 0x22ff22,
          roughness: 0.7,
          metalness: 0.0,
        });
        owned.push(whiteMaterial, redMaterial, greenMaterial);

        const walls: Array<{
          size: [number, number, number];
          pos: [number, number, number];
          mat: THREE.MeshPhysicalMaterial;
          noMesh?: boolean;
        }> = [
          { size: [boxSize.w, t, boxSize.d], pos: [0, -t / 2, 0], mat: whiteMaterial },
          { size: [boxSize.w, t, boxSize.d], pos: [0, boxSize.h + t / 2, 0], mat: whiteMaterial },
          { size: [boxSize.w, boxSize.h, t], pos: [0, hh, -hd - t / 2], mat: whiteMaterial },
          { size: [boxSize.w, boxSize.h, t], pos: [0, hh, hd + t / 2], mat: whiteMaterial, noMesh: true },
          { size: [t, boxSize.h, boxSize.d], pos: [-hw - t / 2, hh, 0], mat: redMaterial },
          { size: [t, boxSize.h, boxSize.d], pos: [hw + t / 2, hh, 0], mat: greenMaterial },
        ];

        for (const w of walls) {
          const shape = world.createBox({
            width: w.size[0],
            height: w.size[1],
            depth: w.size[2],
          });
          world.createStaticBody({ shape, position: w.pos });

          if (!w.noMesh) {
            const geo = new THREE.BoxGeometry(w.size[0], w.size[1], w.size[2]);
            const mesh = new THREE.Mesh(geo, w.mat);
            mesh.position.set(...w.pos);
            mesh.receiveShadow = true;
            scene.add(mesh);
            wallMeshes.push(mesh);
            owned.push({ dispose: () => geo.dispose() });
          }
        }
      }

      function createMannequin() {
        mannequin = buildMannequin({
          world,
          spawnPosition: [0, 0.9, 0],
        });
        mannequin.reset(0.9 + (mannequin.totalHeight / 2 - 0.9));
        scene.add(mannequin.group);
        mannequin.group.traverse((child) => {
          const m = child as THREE.Mesh;
          if ((m as THREE.Mesh).isMesh) {
            m.castShadow = true;
            m.receiveShadow = true;
          }
        });
        owned.push({
          dispose: () => {
            if (!mannequin) return;
            scene.remove(mannequin.group);
            mannequin.dispose();
            mannequin = null;
          },
        });
      }

      function createBalls() {
        ballTypes = sportBallSpecs.map((spec) => {
          const count = BALL_COUNTS[spec.type] ?? 12;
          const mesh = new THREE.InstancedMesh(
            spec.geometry,
            spec.materials.length === 1 ? spec.materials[0] : spec.materials,
            count,
          );
          mesh.castShadow = true;
          mesh.receiveShadow = true;
          scene.add(mesh);

          const hw = boxSize.w / 2 - BALL_RADIUS_HINT - 0.1;
          const hd = boxSize.d / 2 - BALL_RADIUS_HINT - 0.1;
          const bodies: Body[] = [];

          for (let i = 0; i < count; i++) {
            const x = (Math.random() - 0.5) * 2 * hw;
            const y =
              BALL_RADIUS_HINT +
              Math.random() * (boxSize.h - BALL_RADIUS_HINT * 2);
            const z = (Math.random() - 0.5) * 2 * hd;

            const shape =
              spec.physics.kind === "sphere"
                ? world.createSphere({ radius: spec.physics.radius })
                : world.createCylinder({
                    radius: spec.physics.radius,
                    halfHeight: spec.physics.height / 2,
                  });

            const body = world.createDynamicBody({
              shape,
              position: [x, y, z],
              mass: spec.type === "hockey-puck" ? 0.6 : 1,
              restitution: 0.5,
              friction: 0.4,
            });
            bodies.push(body);
          }

          return { spec, mesh, bodies };
        });

        owned.push({
          dispose: () => {
            for (const t of ballTypes) {
              scene.remove(t.mesh);
              t.mesh.dispose();
            }
            ballTypes = [];
          },
        });
      }

      function teardownBox() {
        for (const m of wallMeshes) {
          scene.remove(m);
          m.geometry.dispose();
        }
        wallMeshes = [];
      }

      function rebuildScene() {
        teardownBox();
        for (const t of ballTypes) {
          scene.remove(t.mesh);
          t.mesh.dispose();
        }
        ballTypes = [];

        if (mannequin) {
          scene.remove(mannequin.group);
          mannequin.dispose();
          mannequin = null;
        }

        boxSize.w = getBoxWidth();

        fitCameraToBox();
        createBox();
        createMannequin();
        createBalls();
      }

      function respawnBalls() {
        if (ballTypes.length === 0) return;
        const hw = boxSize.w / 2 - BALL_RADIUS_HINT - 0.1;
        const hd = boxSize.d / 2 - BALL_RADIUS_HINT - 0.1;
        const RESPAWN = 5;

        for (let i = 0; i < RESPAWN; i++) {
          const t = ballTypes[Math.floor(Math.random() * ballTypes.length)];
          if (t.bodies.length === 0) continue;
          const body = t.bodies[Math.floor(Math.random() * t.bodies.length)];

          body.position.set([
            (Math.random() - 0.5) * 2 * hw,
            boxSize.h - BALL_RADIUS_HINT - Math.random() * 1,
            (Math.random() - 0.5) * 2 * hd,
          ]);
          body.linearVelocity.set([0, 0, 0]);
          body.angularVelocity.set([0, 0, 0]);
          body.commitChanges();
        }
      }

      // ---- pointer wiring ----------------------------------------------
      const onPointerDown = (event: PointerEvent) => {
        activePointers.add(event.pointerId);
        if (event.pointerType === "touch") {
          pointerDown = activePointers.size >= 2;
        } else {
          pointerDown = true;
        }
      };
      const onPointerUp = (event: PointerEvent) => {
        activePointers.delete(event.pointerId);
        if (event.pointerType === "touch") {
          pointerDown = activePointers.size >= 2;
        } else {
          pointerDown = false;
        }
      };
      const onPointerMove = (event: PointerEvent) => {
        if (!renderer) return;
        const rect = renderer.domElement.getBoundingClientRect();
        pointer.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
        pointer.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
        raycaster.setFromCamera(pointer, camera);

        mouseRayOriginTarget.copy(raycaster.ray.origin);
        mouseRayDirTarget.copy(raycaster.ray.direction);
        mouseMoving = true;
        if (mouseStopTimer !== null) clearTimeout(mouseStopTimer);
        mouseStopTimer = setTimeout(() => {
          mouseMoving = false;
        }, 50);

        const frontPlane = new THREE.Plane(
          new THREE.Vector3(0, 0, 1),
          -boxSize.d / 2,
        );
        const hit = new THREE.Vector3();
        if (raycaster.ray.intersectPlane(frontPlane, hit)) {
          mouseLightTarget.copy(hit);
        }
      };

      const dom = renderer.domElement;
      dom.addEventListener("pointerdown", onPointerDown);
      dom.addEventListener("pointermove", onPointerMove);
      dom.addEventListener("pointerup", onPointerUp);
      dom.addEventListener("pointercancel", onPointerUp);
      dom.style.touchAction = "none";
      dom.style.cursor = "grab";

      removePointerListeners = () => {
        dom.removeEventListener("pointerdown", onPointerDown);
        dom.removeEventListener("pointermove", onPointerMove);
        dom.removeEventListener("pointerup", onPointerUp);
        dom.removeEventListener("pointercancel", onPointerUp);
        if (mouseStopTimer !== null) clearTimeout(mouseStopTimer);
      };

      // ---- resize ------------------------------------------------------
      const resize = () => {
        if (!renderer) return;
        const w = Math.max(280, mount.clientWidth || 400);
        const h = Math.max(200, Math.round(w * 0.72));
        camera.aspect = w / h;
        camera.updateProjectionMatrix();
        renderer.setSize(w, h, false);
        rebuildScene();
      };

      const w0 = Math.max(280, mount.clientWidth || 400);
      const h0 = Math.max(200, Math.round(w0 * 0.72));
      camera.aspect = w0 / h0;
      camera.updateProjectionMatrix();
      renderer.setSize(w0, h0, false);
      boxSize.w = getBoxWidth();
      fitCameraToBox();
      createBox();
      createMannequin();
      createBalls();

      let resizeTimer: ReturnType<typeof setTimeout> | null = null;
      resizeObserver = new ResizeObserver(() => {
        if (resizeTimer) clearTimeout(resizeTimer);
        resizeTimer = setTimeout(resize, 120);
      });
      resizeObserver.observe(mount);

      // ---- animate ------------------------------------------------------
      const clock = new THREE.Clock();
      const dummy = new THREE.Object3D();
      const closest = new THREE.Vector3();
      const ballPos = new THREE.Vector3();
      const pushDir = new THREE.Vector3();

      const animate = () => {
        if (!alive) return;
        if (!renderer) return;
        raf = requestAnimationFrame(animate);

        const dt = Math.min(clock.getDelta(), 1 / 30);
        const reduce = reduceMotionRef.current;

        const easeFactor = 1 - Math.exp(-EASE_SPEED * dt);
        mouseRayOrigin.lerp(mouseRayOriginTarget, easeFactor);
        mouseRayDir.lerp(mouseRayDirTarget, easeFactor);
        mouseLight.position.lerp(mouseLightTarget, easeFactor);

        if (pointerDown && !reduce) {
          respawnBalls();
        }

        if (mouseMoving && !reduce) {
          for (const t of ballTypes) {
            for (const body of t.bodies) {
              const bp = body.position;
              ballPos.set(bp.x, bp.y, bp.z);
              const ray = new THREE.Ray(mouseRayOrigin, mouseRayDir);
              ray.closestPointToPoint(ballPos, closest);
              const dist = closest.distanceTo(ballPos);
              if (dist < PUSH_RADIUS) {
                pushDir.subVectors(ballPos, closest);
                if (pushDir.lengthSq() < 0.001) pushDir.set(0, 1, 0);
                pushDir.normalize();
                const strength = PUSH_STRENGTH * (1 - dist / PUSH_RADIUS);
                // Bounce types want its own Vec3, but at runtime it reads
                // any `{x,y,z}` literal — same shortcut the WebGPU sibling
                // uses to avoid allocating per-frame.
                body.applyLinearImpulse({
                  x: pushDir.x * strength,
                  y: pushDir.y * strength,
                  z: pushDir.z * strength,
                } as unknown as Parameters<
                  typeof body.applyLinearImpulse
                >[0]);
              }
            }
          }
        }

        if (!reduce) world.advanceTime(1 / 60, dt);

        for (const t of ballTypes) {
          for (let i = 0; i < t.bodies.length; i++) {
            const body = t.bodies[i];
            const p = body.position;
            const q = body.orientation;
            dummy.position.set(p.x, p.y, p.z);
            dummy.quaternion.set(q.x, q.y, q.z, q.w);
            dummy.updateMatrix();
            t.mesh.setMatrixAt(i, dummy.matrix);
          }
          t.mesh.instanceMatrix.needsUpdate = true;
        }

        mannequin?.syncToBody();

        renderer.render(scene, camera);
      };
      animate();
    } catch (err) {
      console.error("[sport-arena-webgl] init failed:", err);
      if (alive) setFailed(true);
      cleanup();
    }

    return cleanup;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (failed) return <VibeFallback aspectRatio={aspectRatio} className={className} />;

  return (
    <div
      ref={mountRef}
      className={
        "relative w-full overflow-hidden rounded-xl border border-foreground/10 " +
        "bg-[color-mix(in_srgb,var(--color-background)_92%,#a0a0a0)] " +
        "shadow-[0_20px_50px_-24px_rgba(0,0,0,0.45)] " +
        "dark:bg-[color-mix(in_srgb,var(--color-background)_88%,#444)] " +
        (className ?? "")
      }
      style={{ aspectRatio }}
      role="img"
      aria-label="Sport-themed ball pool with a mannequin getting bowled by baseballs, basketballs, soccer balls, footballs, and hockey pucks"
    />
  );
}
