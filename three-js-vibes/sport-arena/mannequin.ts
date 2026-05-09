import * as THREE from "three";
import {
  type World,
  type Body,
  type CompoundShape,
} from "@perplexdotgg/bounce";

/**
 * Procedural mannequin for the SSGI Sport Arena.
 *
 * Visual: a single matte-white humanoid built from primitives — head sphere,
 * torso capsule, two arms (upper + lower cylinders), two legs (upper + lower
 * cylinders), pelvis sphere — all parented to one root group so the whole
 * figure tumbles as a unit.
 *
 * Physics: ONE Bounce dynamic body holding a `CompoundShape` made of five
 * sub-shapes (head sphere, torso capsule, two leg capsules, pelvis sphere).
 * That gives sport balls believable contact along the silhouette without us
 * having to manage a true ragdoll (multiple bodies + joint constraints) —
 * still a major lift in fidelity over a single bounding capsule.
 *
 * Why single rigid body, not full ragdoll? With ~100 sport balls hammering
 * the mannequin every frame, a 9-body ragdoll's joint constraints would be
 * the dominant CPU cost in the simulation, and we already pay for the SSGI
 * pass on the GPU. One compound body keeps perf comfortable while still
 * looking like a real mannequin getting bowled over.
 */

export interface Mannequin {
  /** Add this to the scene to render the mannequin. */
  group: THREE.Group;
  /** The dynamic rigid body — host updates with `body.position` etc. */
  body: Body;
  /**
   * Total height of the mannequin along its local +Y axis, in physics units.
   * Useful for clamping spawn position so feet land on the floor.
   */
  totalHeight: number;
  /**
   * Pull `body.position` / `body.orientation` into the scene group. Called
   * every frame from the host's animate loop.
   */
  syncToBody(): void;
  /**
   * Reset the body to its initial pose (centered, upright, zero velocity).
   * Wired up to a "respawn" pointer-down on the host.
   */
  reset(spawnY: number): void;
  /** Free geometries / materials. World cleanup is the host's job. */
  dispose(): void;
}

export interface MannequinOptions {
  /** Bounce world to register the rigid body with. */
  world: World;
  /** Initial spawn position; defaults to (0, totalHeight/2, 0). */
  spawnPosition?: [number, number, number];
}

const TMP_QUAT = new THREE.Quaternion();
const TMP_VEC = new THREE.Vector3();

export function buildMannequin({
  world,
  spawnPosition,
}: MannequinOptions): Mannequin {
  // ---- proportions (in physics units / meters) ----------------------------
  // A real mannequin in a 6m-tall room reads as roughly 1.8m tall. The torso
  // is the heaviest piece, with arms held out slightly so the silhouette
  // isn't a featureless cylinder.
  const HEAD_R = 0.22;
  const NECK_LEN = 0.06;
  const TORSO_R = 0.32;
  const TORSO_LEN = 0.65;
  const PELVIS_R = 0.3;
  const ARM_R = 0.1;
  const ARM_LEN_UPPER = 0.34;
  const ARM_LEN_LOWER = 0.34;
  const LEG_R = 0.14;
  const LEG_LEN_UPPER = 0.45;
  const LEG_LEN_LOWER = 0.45;
  const FOOT_LEN = 0.22;
  const FOOT_W = 0.14;
  const FOOT_H = 0.08;

  const totalHeight =
    LEG_LEN_LOWER +
    LEG_LEN_UPPER +
    PELVIS_R * 0.6 +
    TORSO_LEN +
    NECK_LEN +
    HEAD_R * 2;

  // ---- visual group -------------------------------------------------------

  const group = new THREE.Group();
  // Local origin: center of mass roughly at the chest. We measure y up from
  // the feet, then offset everything down by `feetOffset` so the rigid body
  // center lines up with the chest.
  const FEET_TO_PELVIS = LEG_LEN_LOWER + LEG_LEN_UPPER;
  const PELVIS_Y = FEET_TO_PELVIS;
  const TORSO_CENTER_Y = PELVIS_Y + PELVIS_R * 0.5 + TORSO_LEN / 2;
  const HEAD_CENTER_Y = TORSO_CENTER_Y + TORSO_LEN / 2 + NECK_LEN + HEAD_R;
  // We offset the visual so y=0 (in the group) corresponds to the torso
  // center — same as the rigid body's center of mass.
  const Y_OFFSET = -TORSO_CENTER_Y;

  const skinMat = new THREE.MeshPhysicalMaterial({
    color: 0xece7df,
    roughness: 0.65,
    metalness: 0.0,
    clearcoat: 0.1,
    clearcoatRoughness: 0.4,
    sheen: 0.2,
    sheenColor: new THREE.Color(0xfaf6ee),
  });
  const accentMat = new THREE.MeshPhysicalMaterial({
    color: 0x8c7e6c,
    roughness: 0.5,
    metalness: 0.05,
  });
  const jointMat = new THREE.MeshPhysicalMaterial({
    color: 0x444038,
    roughness: 0.4,
    metalness: 0.2,
  });

  const owned: Array<THREE.BufferGeometry | THREE.Material> = [
    skinMat,
    accentMat,
    jointMat,
  ];

  const addMesh = (
    geo: THREE.BufferGeometry,
    mat: THREE.Material,
    pos: [number, number, number],
    rot?: [number, number, number],
  ) => {
    owned.push(geo);
    const mesh = new THREE.Mesh(geo, mat);
    mesh.position.set(pos[0], pos[1] + Y_OFFSET, pos[2]);
    if (rot) mesh.rotation.set(rot[0], rot[1], rot[2]);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    group.add(mesh);
    return mesh;
  };

  // Head — sphere with a small accent "joint" sphere at the neck.
  addMesh(new THREE.SphereGeometry(HEAD_R, 32, 24), skinMat, [
    0,
    HEAD_CENTER_Y,
    0,
  ]);
  addMesh(
    new THREE.SphereGeometry(HEAD_R * 0.55, 16, 12),
    jointMat,
    [0, HEAD_CENTER_Y - HEAD_R - NECK_LEN * 0.5, 0],
  );

  // Torso — capsule visual approximated with a capsule geometry.
  addMesh(
    new THREE.CapsuleGeometry(TORSO_R, TORSO_LEN - TORSO_R * 2, 8, 16),
    skinMat,
    [0, TORSO_CENTER_Y, 0],
  );

  // Pelvis — squashed sphere.
  addMesh(
    new THREE.SphereGeometry(PELVIS_R, 24, 16),
    skinMat,
    [0, PELVIS_Y, 0],
  );

  // Shoulders
  const SHOULDER_X = TORSO_R + ARM_R * 0.4;
  const SHOULDER_Y = TORSO_CENTER_Y + TORSO_LEN / 2 - TORSO_R * 0.5;
  const ELBOW_Y = SHOULDER_Y - ARM_LEN_UPPER;
  const WRIST_Y = ELBOW_Y - ARM_LEN_LOWER;

  // Arms — built as cylinders with sphere joints at shoulder/elbow/hand.
  for (const sign of [-1, 1]) {
    addMesh(
      new THREE.SphereGeometry(ARM_R * 1.4, 16, 12),
      jointMat,
      [sign * SHOULDER_X, SHOULDER_Y, 0],
    );
    addMesh(
      new THREE.CylinderGeometry(ARM_R, ARM_R, ARM_LEN_UPPER, 16),
      skinMat,
      [sign * SHOULDER_X, SHOULDER_Y - ARM_LEN_UPPER / 2, 0],
    );
    addMesh(
      new THREE.SphereGeometry(ARM_R * 1.1, 16, 12),
      jointMat,
      [sign * SHOULDER_X, ELBOW_Y, 0],
    );
    addMesh(
      new THREE.CylinderGeometry(ARM_R * 0.95, ARM_R, ARM_LEN_LOWER, 16),
      skinMat,
      [sign * SHOULDER_X, ELBOW_Y - ARM_LEN_LOWER / 2, 0],
    );
    addMesh(
      new THREE.SphereGeometry(ARM_R * 1.05, 16, 12),
      accentMat,
      [sign * SHOULDER_X, WRIST_Y, 0],
    );
  }

  // Hips → legs.
  const HIP_X = PELVIS_R * 0.55;
  const HIP_Y = PELVIS_Y;
  const KNEE_Y = HIP_Y - LEG_LEN_UPPER;
  const ANKLE_Y = KNEE_Y - LEG_LEN_LOWER;

  for (const sign of [-1, 1]) {
    addMesh(
      new THREE.SphereGeometry(LEG_R * 1.5, 16, 12),
      jointMat,
      [sign * HIP_X, HIP_Y, 0],
    );
    addMesh(
      new THREE.CylinderGeometry(LEG_R, LEG_R * 1.1, LEG_LEN_UPPER, 16),
      skinMat,
      [sign * HIP_X, HIP_Y - LEG_LEN_UPPER / 2, 0],
    );
    addMesh(
      new THREE.SphereGeometry(LEG_R * 1.2, 16, 12),
      jointMat,
      [sign * HIP_X, KNEE_Y, 0],
    );
    addMesh(
      new THREE.CylinderGeometry(LEG_R * 0.85, LEG_R, LEG_LEN_LOWER, 16),
      skinMat,
      [sign * HIP_X, KNEE_Y - LEG_LEN_LOWER / 2, 0],
    );
    // Foot — a forward-leaning box.
    addMesh(
      new THREE.BoxGeometry(FOOT_W, FOOT_H, FOOT_LEN),
      accentMat,
      [sign * HIP_X, ANKLE_Y - FOOT_H / 2, FOOT_LEN * 0.25],
    );
  }

  // ---- physics: compound shape -------------------------------------------

  // Each sub-shape transform is in the body's local frame. Our body's
  // origin = torso center, so we offset the head up, pelvis/legs down.
  // Sub-shape orientations default to identity (Y-up capsules) which is
  // what we want for an upright mannequin.

  // Bounce capsule height = length of the cylindrical part *only*; total
  // capsule length = height + 2 * radius. We size the shape capsules a hair
  // smaller than their visual counterparts so that contact happens on the
  // visual surface rather than at the collision boundary (looks better).
  const TORSO_CAP_H = Math.max(0.01, TORSO_LEN - TORSO_R * 2);
  const LEG_CAP_H = Math.max(0.01, LEG_LEN_UPPER + LEG_LEN_LOWER - LEG_R * 2);
  const LEG_CENTER_LOCAL_Y = (HIP_Y + ANKLE_Y) / 2 - TORSO_CENTER_Y;
  const HEAD_LOCAL_Y = HEAD_CENTER_Y - TORSO_CENTER_Y;
  const PELVIS_LOCAL_Y = PELVIS_Y - TORSO_CENTER_Y;

  const torsoShape = world.createCapsule({
    radius: TORSO_R * 0.95,
    height: TORSO_CAP_H,
  });
  const headShape = world.createSphere({ radius: HEAD_R * 0.95 });
  const pelvisShape = world.createSphere({ radius: PELVIS_R * 0.9 });
  const legShape = world.createCapsule({
    radius: LEG_R * 1.05,
    height: LEG_CAP_H,
  });

  // CompoundShape needs each sub-shape paired with a transform { position,
  // orientation }. We leave orientation at identity (vertical capsules
  // along +Y, matching the visual cylinders).
  const compound: CompoundShape = world.createCompoundShape([
    {
      shape: torsoShape,
      transform: { position: [0, 0, 0] },
    },
    {
      shape: headShape,
      transform: { position: [0, HEAD_LOCAL_Y, 0] },
    },
    {
      shape: pelvisShape,
      transform: { position: [0, PELVIS_LOCAL_Y, 0] },
    },
    {
      shape: legShape,
      transform: { position: [-HIP_X, LEG_CENTER_LOCAL_Y, 0] },
    },
    {
      shape: legShape,
      transform: { position: [HIP_X, LEG_CENTER_LOCAL_Y, 0] },
    },
  ]);

  const initial = spawnPosition ?? [0, totalHeight / 2 + Y_OFFSET, 0];
  // Heavier than balls (mass 1) but not so heavy that 100+ ball impacts
  // can't tip it over — a healthy 12kg lets the silhouette get bowled.
  const body = world.createDynamicBody({
    shape: compound,
    position: initial,
    mass: 12,
    restitution: 0.25,
    friction: 0.6,
    linearDamping: 0.4,
    angularDamping: 0.5,
  });

  // ---- sync helpers -------------------------------------------------------

  function syncToBody() {
    const p = body.position;
    const q = body.orientation;
    group.position.set(p.x, p.y, p.z);
    TMP_QUAT.set(q.x, q.y, q.z, q.w);
    group.quaternion.copy(TMP_QUAT);
  }

  function reset(spawnY: number) {
    body.position.set([0, spawnY, 0]);
    // Identity orientation = upright + facing forward.
    body.orientation.set([0, 0, 0, 1]);
    body.linearVelocity.set([0, 0, 0]);
    body.angularVelocity.set([0, 0, 0]);
    body.commitChanges();
    TMP_VEC.set(0, spawnY, 0);
    group.position.copy(TMP_VEC);
    group.quaternion.identity();
  }

  function dispose() {
    for (const item of owned) {
      if ("dispose" in item) item.dispose();
    }
  }

  // First frame: sync position immediately so we don't render the mannequin
  // at world origin for one frame before the physics step runs.
  syncToBody();

  return {
    group,
    body,
    totalHeight,
    syncToBody,
    reset,
    dispose,
  };
}
