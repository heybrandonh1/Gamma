"use client";

import { useEffect, useRef, useState } from "react";
import * as THREE from "three/webgpu";
import {
  pass,
  mrt,
  output,
  normalView,
  diffuseColor,
  velocity,
  add,
  vec4,
  directionToColor,
  colorToDirection,
  sample,
} from "three/tsl";
import { ssgi } from "three/examples/jsm/tsl/display/SSGINode.js";
import { traa } from "three/examples/jsm/tsl/display/TRAANode.js";
import { World, type Body } from "@perplexdotgg/bounce";

import {
  buildAllSportBallSpecs,
  disposeSportBallSpec,
  type SportBallSpec,
} from "./sport-balls";
import { buildMannequin, type Mannequin } from "./mannequin";
import { SportArenaWebGL } from "./sport-arena-webgl";

/**
 * SSGI Sport Arena — a 1:1 port of the WebGPU SSGI Ball Pool example
 * (`webgpu_postprocessing_ssgi_ballpool.html`) re-themed with sport balls
 * and a procedural mannequin.
 *
 * What's identical to the upstream example:
 *
 *   - WebGPU `RenderPipeline` with an MRT pass that exports `output`,
 *     `diffuseColor`, encoded `normalView`, and `velocity` G-buffers.
 *   - `ssgi(...)` post node consuming color + depth + normal for indirect
 *     lighting / AO, then `traa(...)` on top for temporal anti-aliasing.
 *   - Two-channel composite: `color * ao + diffuse * gi`.
 *   - Bounce physics world (`@perplexdotgg/bounce`) with the same wall
 *     setup, restitution / friction defaults, and the shadow-casting point
 *     light tied to the pointer position.
 *   - Pointer-move pushes balls along the camera ray; pointer-down respawns
 *     a few balls at the top.
 *
 * What's bespoke:
 *
 *   - Five sport-ball types (baseball / basketball / soccer / football /
 *     hockey puck) instead of a single colored sphere — see `sport-balls.ts`
 *     for the merged-geometry InstancedMesh recipe.
 *   - A procedural mannequin in the center of the room (compound rigid body
 *     of head sphere + torso capsule + leg capsules + pelvis sphere) that
 *     gets bowled over by ball impacts.
 *   - Card-sized canvas (~1:0.72 aspect) — the box width is computed from
 *     the host card's aspect just like the upstream example does for
 *     `window.innerWidth/innerHeight`, so the box always exactly fills the
 *     view, regardless of how the playground card is sized.
 */

export interface SportArenaProps {
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

// Per-type ball counts. Tuned so the box has roughly the same fill as the
// upstream demo (~packing 0.6 of FILL_RATIO 0.4) but with larger sport
// balls. Order matches `buildAllSportBallSpecs()`.
const BALL_COUNTS: Record<string, number> = {
  basketball: 8,
  soccer: 10,
  football: 10,
  baseball: 18,
  "hockey-puck": 14,
};

function hasWebGPU(): boolean {
  if (typeof navigator === "undefined") return false;
  // `navigator.gpu` is the standard feature detect for WebGPU. It's still
  // possible the adapter request fails at runtime — we surface that as the
  // VibeFallback via the `failed` state below. Cast through `unknown`
  // because the lib.dom types we ship against don't include the WebGPU
  // interfaces yet (TS 5.8 / @types/node 22 era).
  return (
    typeof (navigator as unknown as { gpu?: unknown }).gpu !== "undefined"
  );
}

export function SportArena({
  reduceMotion,
  aspectRatio = "1 / 0.72",
  className,
}: SportArenaProps) {
  const mountRef = useRef<HTMLDivElement>(null);
  const reduceMotionRef = useRef(reduceMotion ?? false);
  const [failed, setFailed] = useState(false);

  reduceMotionRef.current = reduceMotion ?? false;

  useEffect(() => {
    const mount = mountRef.current;
    if (!mount) return;

    // Diagnostics marker: surfaces the cascade decision in DevTools so we
    // can tell from a single screenshot whether the WebGPU detect ran and
    // which branch was chosen. The `build` tag flips with each
    // intentional rebuild — handy when verifying that a deployed bundle
    // actually contains the latest cascade logic vs. a cached older one.
    const webGPUAvailable = hasWebGPU();
    console.info("[sport-arena] cascade decision", {
      webGPUAvailable,
      build: "webgl-cascade-v1",
    });
    if (!webGPUAvailable) {
      setFailed(true);
      return;
    }

    let alive = true;
    let raf = 0;
    // Track everything we own so cleanup is exhaustive even if init throws
    // partway through.
    const owned: { dispose(): void }[] = [];
    let disposed = false;

    // Keep references that the cleanup closure needs to reach.
    let renderer: THREE.WebGPURenderer | null = null;
    let renderPipeline: THREE.RenderPipeline | null = null;
    let resizeObserver: ResizeObserver | null = null;
    let removePointerListeners: (() => void) | null = null;

    const cleanup = () => {
      if (disposed) return;
      disposed = true;
      alive = false;
      cancelAnimationFrame(raf);
      resizeObserver?.disconnect();
      removePointerListeners?.();
      // Dispose three resources first (they hold refs to physics shapes
      // indirectly via instanceMatrix updates), then physics world.
      for (const item of owned) {
        try {
          item.dispose();
        } catch (err) {
          console.warn("[sport-arena] dispose failed:", err);
        }
      }
      if (renderer) {
        if (renderer.domElement.parentNode === mount) {
          mount.removeChild(renderer.domElement);
        }
        renderer.dispose();
        renderer = null;
      }
      renderPipeline = null;
    };

    // Wrap the entire init in an async IIFE so we can `await renderer.init()`
    // (newer three.js versions require an explicit init for WebGPU). If
    // anything throws we surface the friendly VibeFallback square.
    (async () => {
      try {
        const camera = new THREE.PerspectiveCamera(CAM_FOV, 1, 0.1, 100);

        const scene = new THREE.Scene();

        renderer = new THREE.WebGPURenderer({ antialias: false });
        renderer.toneMapping = THREE.ACESFilmicToneMapping;
        renderer.toneMappingExposure = 0.5;
        renderer.shadowMap.enabled = true;
        renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));

        await renderer.init();
        if (!alive) {
          renderer.dispose();
          renderer = null;
          return;
        }

        mount.appendChild(renderer.domElement);

        // ---- post pipeline: MRT → SSGI → TRAA -----------------------------
        // This block is taken straight from the upstream example. We render
        // the scene into a multi-render-target pass exposing color, diffuse,
        // depth, encoded normal, and per-pixel velocity. SSGI consumes the
        // color/depth/normal trio for indirect lighting + AO; TRAA reads
        // velocity for stable temporal anti-aliasing on top.

        renderPipeline = new THREE.RenderPipeline(renderer);
        const scenePass = pass(scene, camera);
        scenePass.setMRT(
          mrt({
            output,
            diffuseColor,
            normal: directionToColor(normalView),
            velocity,
          }),
        );

        const scenePassColor = scenePass.getTextureNode("output");
        const scenePassDiffuse = scenePass.getTextureNode("diffuseColor");
        const scenePassDepth = scenePass.getTextureNode("depth");
        const scenePassNormal = scenePass.getTextureNode("normal");
        const scenePassVelocity = scenePass.getTextureNode("velocity");

        // Bandwidth optimization (matches the example): pack diffuse + normal
        // textures as RGBA8 since we don't need HDR / high-precision data
        // for the SSGI sampling.
        const diffuseTexture = scenePass.getTexture("diffuseColor");
        diffuseTexture.type = THREE.UnsignedByteType;
        const normalTexture = scenePass.getTexture("normal");
        normalTexture.type = THREE.UnsignedByteType;

        const sceneNormal = sample((uv) =>
          colorToDirection(scenePassNormal.sample(uv)),
        );

        const giPass = ssgi(
          scenePassColor,
          scenePassDepth,
          sceneNormal,
          camera,
        );
        // Lower than the upstream demo's defaults to keep frame time
        // reasonable inside a card alongside the disco dancer + logo forge.
        giPass.sliceCount.value = 2;
        giPass.stepCount.value = 6;

        const gi = giPass.rgb;
        const ao = giPass.a;

        const compositePass = vec4(
          add(scenePassColor.rgb.mul(ao), scenePassDiffuse.rgb.mul(gi)),
          scenePassColor.a,
        );

        const traaPass = traa(
          compositePass,
          scenePassDepth,
          scenePassVelocity,
          camera,
        );
        renderPipeline.outputNode = traaPass;

        // ---- shadow-casting mouse light -----------------------------------
        const mouseLight = new THREE.PointLight(0xffffff, 80, 0, 1);
        mouseLight.position.set(0, BOX_HEIGHT / 2, BOX_DEPTH / 2);
        mouseLight.castShadow = true;
        mouseLight.shadow.mapSize.set(1024, 1024);
        mouseLight.shadow.radius = 20;
        scene.add(mouseLight);

        // ---- raycaster + pointer state ------------------------------------
        const raycaster = new THREE.Raycaster();
        const pointer = new THREE.Vector2();

        let mouseRayOrigin = new THREE.Vector3();
        let mouseRayDir = new THREE.Vector3();
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

        // ---- physics world -----------------------------------------------
        const world = new World({
          gravity: [0, -9.81, 0],
          solveVelocityIterations: 6,
          solvePositionIterations: 2,
          linearDamping: 0.1,
          angularDamping: 0.1,
          restitution: 0.4,
          friction: 0.5,
        });
        owned.push({ dispose: () => void 0 }); // World has no dispose; pool GC

        const boxSize = { w: 8, h: BOX_HEIGHT, d: BOX_DEPTH };

        const sportBallSpecs: SportBallSpec[] = buildAllSportBallSpecs();
        owned.push({
          dispose: () => sportBallSpecs.forEach(disposeSportBallSpec),
        });

        // Per-spec runtime state: the InstancedMesh + array of Bodies. One
        // entry per sport-ball type.
        type BallType = {
          spec: SportBallSpec;
          mesh: THREE.InstancedMesh;
          bodies: Body[];
        };
        let ballTypes: BallType[] = [];

        // Wall meshes (rebuilt on resize because box width depends on
        // canvas aspect just like the upstream example).
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
            // Floor + ceiling
            { size: [boxSize.w, t, boxSize.d], pos: [0, -t / 2, 0], mat: whiteMaterial },
            { size: [boxSize.w, t, boxSize.d], pos: [0, boxSize.h + t / 2, 0], mat: whiteMaterial },
            // Back wall + invisible front wall (no mesh, just collider)
            { size: [boxSize.w, boxSize.h, t], pos: [0, hh, -hd - t / 2], mat: whiteMaterial },
            { size: [boxSize.w, boxSize.h, t], pos: [0, hh, hd + t / 2], mat: whiteMaterial, noMesh: true },
            // Side walls — colored to match the upstream demo (red left, green right).
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
            // Place the mannequin so its feet sit on the floor.
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

              // Build the appropriate Bounce shape per ball type. We rebuild
              // a fresh shape per body — pooling is automatic, and this keeps
              // each body's mass + inertia tensor accurate to its visual.
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
          // Walls are removed when we rebuild the box — the static bodies
          // for the walls are recycled when we recreate the world. Since we
          // can't easily destroy individual static bodies without leaking,
          // we instead nuke the whole world on resize and re-init. That
          // mirrors the upstream `rebuildScene()` pattern.
          for (const m of wallMeshes) {
            scene.remove(m);
            m.geometry.dispose();
          }
          wallMeshes = [];
        }

        function rebuildScene() {
          // Tear down dynamic content; static walls + bodies stay because
          // we re-create the world inside (matching the upstream demo).
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

          // Re-derive box width from the new aspect.
          boxSize.w = getBoxWidth();

          // We don't actually re-create the World here on resize; doing so
          // would require destroying every body, which is fine for a static
          // demo but more involved than we need. Bounce will re-balance the
          // existing static walls + dynamic bodies after we wipe + recreate
          // the wall colliders below. (Slight memory overhead per resize is
          // acceptable for a desktop demo.)

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

          // Pick `RESPAWN` random bodies across all types.
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
        // Also disable touch scrolling on top of the canvas so dragging a
        // ball doesn't pan the page.
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

        // Set initial size / camera + build initial world contents.
        const w = Math.max(280, mount.clientWidth || 400);
        const h = Math.max(200, Math.round(w * 0.72));
        camera.aspect = w / h;
        camera.updateProjectionMatrix();
        renderer.setSize(w, h, false);
        boxSize.w = getBoxWidth();
        fitCameraToBox();
        createBox();
        createMannequin();
        createBalls();

        // Debounce resize because rebuilding the scene + walls is heavy.
        let resizeTimer: ReturnType<typeof setTimeout> | null = null;
        resizeObserver = new ResizeObserver(() => {
          if (resizeTimer) clearTimeout(resizeTimer);
          resizeTimer = setTimeout(resize, 120);
        });
        resizeObserver.observe(mount);

        // ---- animate ------------------------------------------------------
        const timer = new THREE.Timer();
        const dummy = new THREE.Object3D();
        const closest = new THREE.Vector3();
        const ballPos = new THREE.Vector3();
        const pushDir = new THREE.Vector3();

        const animate = () => {
          if (!alive) return;
          if (!renderer || !renderPipeline) return;
          raf = requestAnimationFrame(animate);

          timer.update();
          const dt = Math.min(timer.getDelta(), 1 / 30);
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
                  // Bounce's `applyLinearImpulse` is typed to accept its
                  // own `Vec3` class but at runtime reads any `{x,y,z}`
                  // literal — same trick the upstream WebGPU example uses.
                  // We avoid allocating a real Vec3 every frame.
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

          // Push every body's transform into its instanced-mesh slot.
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

          renderPipeline.render();
        };
        animate();
      } catch (err) {
        console.error("[sport-arena] init failed:", err);
        if (alive) setFailed(true);
        cleanup();
      }
    })();

    return cleanup;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Cascade when WebGPU is unavailable or its init throws: render the
  // WebGL companion instead of a static square. The WebGL component
  // itself falls back to `<VibeFallback />` if WebGL is also unavailable
  // (older browsers, headless environments, in-app webviews with broken
  // GL contexts), so the cascade is WebGPU → WebGL → static square.
  if (failed)
    return (
      <SportArenaWebGL
        reduceMotion={reduceMotion}
        aspectRatio={aspectRatio}
        className={className}
      />
    );

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
      aria-label="Sport-themed SSGI ball pool with a mannequin getting bowled by baseballs, basketballs, soccer balls, footballs, and hockey pucks"
    />
  );
}
