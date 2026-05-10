import * as THREE from "three";

import { findBone } from "./bone-utils";

/**
 * Pirate outfit: a single attach-to-rig helper that bolts the full pirate
 * costume onto a Mixamo skeleton — black tricorn hat with a skull patch
 * and red plume on the head, leather eyepatch on the head, colorful
 * parrot perched on the left shoulder, brass-and-steel cutlass in the
 * right hand, and a navy/red tint applied to the body materials so the
 * dancer's default outfit reads as a pirate's coat instead of the bare
 * Mixamo "Beta" texture.
 *
 * Returns a single dispose() that unparents and frees every accessory.
 * The body tint is reverted on dispose too — important because the
 * source FBX's materials are shared with the SkeletonUtils-cloned side
 * dancers, and we don't want a lingering tint to leak into a future
 * mount.
 */

export interface AttachPirateOutfitOptions {
  /** Loaded FBX root with Mixamo bones. */
  root: THREE.Object3D;
  /**
   * Uniform scale applied to every accessory group. Use < 1 for the
   * smaller side dancers so their gear doesn't out-mass the lead.
   */
  scale?: number;
  /**
   * Whether to tint the body materials. Should only be true for the
   * lead dancer — side dancers share materials with the source via
   * `SkeletonUtils.clone`, so the lead's tint already shows on them.
   * Tinting again would double-darken.
   */
  tintBody?: boolean;
}

export interface PirateOutfit {
  dispose: () => void;
}

/** Pirate-coat navy used for the body tint multiplier. */
const BODY_TINT = new THREE.Color(0x2a3a5a);

interface RestoreEntry {
  mat: THREE.Material & { color?: THREE.Color };
  prevColor: THREE.Color;
}

/**
 * Build a black tricorn hat: rounded crown, wide oval brim with three
 * "wings" folded up at 0/120/240 degrees, gold trim along the brim
 * edge, white skull-and-crossbones patch on the front, and a tall red
 * plume rising from the back-right wing.
 */
function buildTricornHat(geos: THREE.BufferGeometry[], mats: THREE.Material[]): THREE.Group {
  const group = new THREE.Group();
  group.name = "pirate-tricorn-hat";

  // ---- Brim: wide flat ellipse ----------------------------------------
  // Cylinder with low height + Z-axis squash gives the classic oval brim
  // shape (longer front-to-back than side-to-side).
  const brimGeo = new THREE.CylinderGeometry(13, 13, 0.9, 48);
  const brimMat = new THREE.MeshPhysicalMaterial({
    color: 0x1a1411,
    roughness: 0.6,
    metalness: 0.0,
    sheen: 0.5,
    sheenColor: new THREE.Color(0x352a22),
    clearcoat: 0.3,
    clearcoatRoughness: 0.4,
  });
  const brim = new THREE.Mesh(brimGeo, brimMat);
  brim.position.y = 2;
  brim.scale.z = 0.78;
  brim.castShadow = true;
  group.add(brim);
  geos.push(brimGeo);
  mats.push(brimMat);

  // Gold trim around the brim's outer edge.
  const trimGeo = new THREE.TorusGeometry(13, 0.45, 10, 64);
  const trimMat = new THREE.MeshPhysicalMaterial({
    color: 0xf5c75a,
    metalness: 1,
    roughness: 0.18,
    clearcoat: 1,
    clearcoatRoughness: 0.06,
    emissive: 0x3a2a05,
    emissiveIntensity: 0.25,
  });
  const trim = new THREE.Mesh(trimGeo, trimMat);
  trim.position.y = 2;
  trim.rotation.x = Math.PI / 2;
  trim.scale.z = 0.78;
  trim.castShadow = true;
  group.add(trim);
  geos.push(trimGeo);
  mats.push(trimMat);

  // ---- Three folded-up wings ------------------------------------------
  // Each "wing" is a thin curved plate attached to the brim's edge and
  // tipped upward by ~70°. Three of them at 0° (front), 120°, 240° give
  // the iconic tricorn silhouette: fold-points at front and rear sides.
  const wingGeo = new THREE.CylinderGeometry(7, 7, 0.7, 28, 1, false, -0.55, 1.1);
  const wingMat = new THREE.MeshPhysicalMaterial({
    color: 0x18120f,
    roughness: 0.55,
    metalness: 0.0,
    sheen: 0.5,
    sheenColor: new THREE.Color(0x352a22),
  });
  geos.push(wingGeo);
  mats.push(wingMat);
  const wingAngles = [0, (2 * Math.PI) / 3, (4 * Math.PI) / 3];
  for (const a of wingAngles) {
    const wing = new THREE.Mesh(wingGeo, wingMat);
    // Position the wing's centre out at the brim radius so its arc
    // hugs the brim edge before the upward rotation tips it skyward.
    const r = 6.2;
    wing.position.set(Math.cos(a) * r, 4.4, Math.sin(a) * r * 0.78);
    // Rotate around an axis tangent to the brim (perpendicular to the
    // radial direction) so the plate folds upward, not sideways.
    wing.rotation.set(0, -a + Math.PI / 2, 1.1);
    wing.scale.set(1.05, 1, 0.45);
    wing.castShadow = true;
    group.add(wing);
  }

  // ---- Crown: rounded dome --------------------------------------------
  const crownGeo = new THREE.SphereGeometry(8, 28, 18, 0, Math.PI * 2, 0, Math.PI / 2);
  const crownMat = brimMat;
  const crown = new THREE.Mesh(crownGeo, crownMat);
  crown.position.y = 2.4;
  crown.scale.set(1.0, 0.7, 0.9);
  crown.castShadow = true;
  group.add(crown);
  geos.push(crownGeo);

  // ---- Skull-and-crossbones patch on the front ------------------------
  // Tiny additive emissive cluster — skull (sphere) with two crossed
  // bones (boxes) underneath. Sits just above the brim on the front
  // side. Additive so it reads as a "painted patch" against the dark
  // hat regardless of scene lighting.
  const skullGeo = new THREE.SphereGeometry(1.2, 14, 10);
  const skullMat = new THREE.MeshBasicMaterial({
    color: 0xffffff,
    transparent: true,
    opacity: 0.95,
  });
  const skull = new THREE.Mesh(skullGeo, skullMat);
  skull.position.set(0, 4.2, 7.8 * 0.78);
  group.add(skull);
  geos.push(skullGeo);
  mats.push(skullMat);

  const boneGeo = new THREE.BoxGeometry(2.6, 0.35, 0.25);
  const boneMat = skullMat;
  for (let i = 0; i < 2; i++) {
    const b = new THREE.Mesh(boneGeo, boneMat);
    b.position.set(0, 3.3, 7.6 * 0.78);
    b.rotation.z = i === 0 ? Math.PI / 4 : -Math.PI / 4;
    group.add(b);
  }
  geos.push(boneGeo);

  // Two tiny black "eye sockets" on the skull so it actually reads as a
  // skull and not a white blob.
  const socketGeo = new THREE.SphereGeometry(0.3, 8, 6);
  const socketMat = new THREE.MeshBasicMaterial({ color: 0x080808 });
  for (let i = 0; i < 2; i++) {
    const s = new THREE.Mesh(socketGeo, socketMat);
    s.position.set(i === 0 ? -0.4 : 0.4, 4.3, 8.6 * 0.78);
    group.add(s);
  }
  geos.push(socketGeo);
  mats.push(socketMat);

  // ---- Red plume rising from the back ----------------------------------
  // Long thin scaled cone, leaned back so it arches behind the crown.
  const plumeGeo = new THREE.ConeGeometry(0.9, 11, 12);
  const plumeMat = new THREE.MeshPhysicalMaterial({
    color: 0xc8252b,
    roughness: 0.55,
    metalness: 0.0,
    emissive: 0x3a0a0d,
    emissiveIntensity: 0.4,
    sheen: 0.7,
    sheenColor: new THREE.Color(0xff8090),
  });
  const plume = new THREE.Mesh(plumeGeo, plumeMat);
  plume.position.set(-1.5, 9, -5.2);
  plume.rotation.set(-0.45, 0, 0.18);
  plume.castShadow = true;
  group.add(plume);
  geos.push(plumeGeo);
  mats.push(plumeMat);

  return group;
}

/**
 * Eyepatch: small black disk parented to the head bone, sitting in front
 * of the right eye, with a thin strap running across the brow line.
 */
function buildEyepatch(geos: THREE.BufferGeometry[], mats: THREE.Material[]): THREE.Group {
  const group = new THREE.Group();
  group.name = "pirate-eyepatch";

  const patchGeo = new THREE.CircleGeometry(1.7, 24);
  const patchMat = new THREE.MeshPhysicalMaterial({
    color: 0x080808,
    roughness: 0.6,
    metalness: 0.0,
    side: THREE.DoubleSide,
  });
  const patch = new THREE.Mesh(patchGeo, patchMat);
  patch.position.set(2.2, 1.4, 6.6);
  patch.rotation.y = -0.25;
  group.add(patch);
  geos.push(patchGeo);
  mats.push(patchMat);

  // Thin leather strap arching across the head — torus tilted so the
  // ring crosses the forehead at the right angle.
  const strapGeo = new THREE.TorusGeometry(6.2, 0.18, 6, 36);
  const strapMat = new THREE.MeshPhysicalMaterial({
    color: 0x141414,
    roughness: 0.7,
    metalness: 0.0,
  });
  const strap = new THREE.Mesh(strapGeo, strapMat);
  strap.position.set(0, 1.6, 2);
  strap.rotation.set(Math.PI / 2.2, 0.1, 0.05);
  strap.scale.set(1.05, 1, 0.65);
  group.add(strap);
  geos.push(strapGeo);
  mats.push(strapMat);

  return group;
}

/**
 * Parrot: a small procedural macaw (green body, red head, blue wings,
 * yellow beak, multi-colored tail) sized to perch on a Mixamo shoulder
 * bone.
 */
function buildParrot(geos: THREE.BufferGeometry[], mats: THREE.Material[]): THREE.Group {
  const group = new THREE.Group();
  group.name = "pirate-parrot";

  // Body — emerald green ellipsoid leaning slightly back so the parrot
  // looks alert rather than slumped.
  const bodyGeo = new THREE.SphereGeometry(2.2, 18, 14);
  const bodyMat = new THREE.MeshPhysicalMaterial({
    color: 0x1ea84a,
    roughness: 0.45,
    metalness: 0.0,
    sheen: 0.5,
    sheenColor: new THREE.Color(0x6effa1),
  });
  const body = new THREE.Mesh(bodyGeo, bodyMat);
  body.scale.set(1, 1.35, 1.05);
  body.castShadow = true;
  group.add(body);
  geos.push(bodyGeo);
  mats.push(bodyMat);

  // Head — bright red sphere on top of the body, tipped slightly
  // forward.
  const headGeo = new THREE.SphereGeometry(1.5, 18, 14);
  const headMat = new THREE.MeshPhysicalMaterial({
    color: 0xd6232f,
    roughness: 0.4,
    metalness: 0.0,
    sheen: 0.6,
    sheenColor: new THREE.Color(0xff8090),
  });
  const head = new THREE.Mesh(headGeo, headMat);
  head.position.set(0, 2.6, 0.6);
  head.castShadow = true;
  group.add(head);
  geos.push(headGeo);
  mats.push(headMat);

  // Beak — yellow-orange curved cone hooked downward.
  const beakGeo = new THREE.ConeGeometry(0.5, 1.4, 12);
  const beakMat = new THREE.MeshPhysicalMaterial({
    color: 0xffb330,
    roughness: 0.35,
    metalness: 0.05,
    clearcoat: 0.5,
    clearcoatRoughness: 0.15,
  });
  const beak = new THREE.Mesh(beakGeo, beakMat);
  beak.position.set(0, 2.5, 1.9);
  beak.rotation.x = Math.PI / 1.6;
  group.add(beak);
  geos.push(beakGeo);
  mats.push(beakMat);

  // Eyes — two tiny black dots either side of the head.
  const eyeGeo = new THREE.SphereGeometry(0.2, 8, 6);
  const eyeMat = new THREE.MeshBasicMaterial({ color: 0x050505 });
  for (let i = 0; i < 2; i++) {
    const e = new THREE.Mesh(eyeGeo, eyeMat);
    e.position.set(i === 0 ? -1.0 : 1.0, 2.85, 1.2);
    group.add(e);
  }
  geos.push(eyeGeo);
  mats.push(eyeMat);

  // Wings — flat blue plates folded against the body sides.
  const wingGeo = new THREE.SphereGeometry(1.4, 12, 10, 0, Math.PI, 0, Math.PI);
  const wingMat = new THREE.MeshPhysicalMaterial({
    color: 0x1f5fdb,
    roughness: 0.45,
    metalness: 0.0,
    sheen: 0.4,
    sheenColor: new THREE.Color(0x6fa1ff),
  });
  for (let i = 0; i < 2; i++) {
    const w = new THREE.Mesh(wingGeo, wingMat);
    w.position.set(i === 0 ? -1.6 : 1.6, 0.4, -0.1);
    w.rotation.set(0, i === 0 ? Math.PI / 2 : -Math.PI / 2, 0);
    w.scale.set(0.55, 1.4, 1.1);
    group.add(w);
  }
  geos.push(wingGeo);
  mats.push(wingMat);

  // Tail feathers — three long cones in red / yellow / blue arching
  // back from the rump.
  const tailGeo = new THREE.ConeGeometry(0.4, 4, 10);
  const tailColors = [0xd6232f, 0xffd400, 0x1f5fdb];
  for (let i = 0; i < tailColors.length; i++) {
    const tailMat = new THREE.MeshPhysicalMaterial({
      color: tailColors[i],
      roughness: 0.5,
      metalness: 0.0,
      sheen: 0.4,
      sheenColor: new THREE.Color(0xffffff),
    });
    const t = new THREE.Mesh(tailGeo, tailMat);
    const offset = (i - 1) * 0.55;
    t.position.set(offset, -1.6, -2.4);
    t.rotation.set(-Math.PI / 2.6, 0, offset * 0.25);
    group.add(t);
    mats.push(tailMat);
  }
  geos.push(tailGeo);

  // Two stubby feet to anchor the parrot on the shoulder visually.
  const footGeo = new THREE.CylinderGeometry(0.2, 0.2, 0.7, 8);
  const footMat = new THREE.MeshPhysicalMaterial({
    color: 0x6e3a14,
    roughness: 0.7,
    metalness: 0.05,
  });
  for (let i = 0; i < 2; i++) {
    const f = new THREE.Mesh(footGeo, footMat);
    f.position.set(i === 0 ? -0.6 : 0.6, -2.4, 0.2);
    group.add(f);
  }
  geos.push(footGeo);
  mats.push(footMat);

  return group;
}

/**
 * Cutlass sword: brass crossguard, curved wood handle wrap, brass pommel,
 * polished steel blade. Sized to fit a Mixamo right-hand bone.
 */
function buildCutlass(geos: THREE.BufferGeometry[], mats: THREE.Material[]): THREE.Group {
  const group = new THREE.Group();
  group.name = "pirate-cutlass";

  // Blade — long thin polished steel box, slightly tapered at the tip
  // by extruding via a flattened cone for the point.
  const bladeGeo = new THREE.BoxGeometry(0.45, 22, 1.6);
  const bladeMat = new THREE.MeshPhysicalMaterial({
    color: 0xeaeaea,
    metalness: 1,
    roughness: 0.18,
    clearcoat: 1,
    clearcoatRoughness: 0.05,
    envMapIntensity: 1.6,
    emissive: 0x202020,
    emissiveIntensity: 0.15,
  });
  const blade = new THREE.Mesh(bladeGeo, bladeMat);
  blade.position.y = 13;
  blade.castShadow = true;
  group.add(blade);
  geos.push(bladeGeo);
  mats.push(bladeMat);

  // Pointed tip — flat-faced cone capping the blade's top.
  const tipGeo = new THREE.ConeGeometry(0.85, 2.4, 8);
  const tip = new THREE.Mesh(tipGeo, bladeMat);
  tip.position.y = 25.2;
  tip.scale.x = 0.55;
  group.add(tip);
  geos.push(tipGeo);

  // Crossguard — D-shaped curved bar that arcs over the hand. Built from
  // a half-torus so it mimics the classic cutlass guard rather than a
  // straight cross.
  const guardGeo = new THREE.TorusGeometry(2.2, 0.45, 10, 24, Math.PI);
  const guardMat = new THREE.MeshPhysicalMaterial({
    color: 0xc8a63a,
    metalness: 1,
    roughness: 0.22,
    clearcoat: 0.8,
    clearcoatRoughness: 0.1,
    emissive: 0x2a1d05,
    emissiveIntensity: 0.25,
  });
  const guard = new THREE.Mesh(guardGeo, guardMat);
  guard.position.y = 1.4;
  guard.rotation.set(Math.PI / 2, 0, 0);
  guard.castShadow = true;
  group.add(guard);
  geos.push(guardGeo);
  mats.push(guardMat);

  // Small straight crossbar through the centre so the guard reads as a
  // proper hilt rather than a floating arc.
  const crossbarGeo = new THREE.CylinderGeometry(0.35, 0.35, 4.2, 12);
  const crossbar = new THREE.Mesh(crossbarGeo, guardMat);
  crossbar.position.y = 1.4;
  crossbar.rotation.z = Math.PI / 2;
  group.add(crossbar);
  geos.push(crossbarGeo);

  // Handle — leather-wrapped wood. Cylinder with a wood-brown matte finish.
  const handleGeo = new THREE.CylinderGeometry(0.55, 0.55, 4.2, 16);
  const handleMat = new THREE.MeshPhysicalMaterial({
    color: 0x5a3a1d,
    roughness: 0.7,
    metalness: 0.0,
    sheen: 0.4,
    sheenColor: new THREE.Color(0x8a5a2d),
  });
  const handle = new THREE.Mesh(handleGeo, handleMat);
  handle.position.y = -1.4;
  handle.castShadow = true;
  group.add(handle);
  geos.push(handleGeo);
  mats.push(handleMat);

  // Pommel — brass cap at the bottom of the handle.
  const pommelGeo = new THREE.SphereGeometry(0.85, 14, 10);
  const pommel = new THREE.Mesh(pommelGeo, guardMat);
  pommel.position.y = -3.8;
  pommel.castShadow = true;
  group.add(pommel);
  geos.push(pommelGeo);

  return group;
}

/**
 * Sash: wide red diagonal strip across the torso. Builds a thin ring
 * tilted on its long axis so it wraps the body at a shoulder-to-hip
 * angle. Parented to the spine so it follows the body rather than the
 * arms.
 */
function buildSash(geos: THREE.BufferGeometry[], mats: THREE.Material[]): THREE.Group {
  const group = new THREE.Group();
  group.name = "pirate-sash";

  const sashGeo = new THREE.TorusGeometry(15, 2.4, 4, 32);
  const sashMat = new THREE.MeshPhysicalMaterial({
    color: 0xb01a26,
    roughness: 0.55,
    metalness: 0.0,
    sheen: 0.5,
    sheenColor: new THREE.Color(0xff8090),
  });
  const sash = new THREE.Mesh(sashGeo, sashMat);
  sash.rotation.set(Math.PI / 2, 0, 0.55);
  sash.scale.set(0.95, 1.0, 0.55);
  group.add(sash);
  geos.push(sashGeo);
  mats.push(sashMat);

  return group;
}

/**
 * Walk every SkinnedMesh in the rig, multiply the diffuse color toward a
 * pirate navy, and remember the original color so we can put it back on
 * dispose. Returns the list of restore entries.
 *
 * We only touch skinned meshes (the dancer's body) — other meshes that
 * might end up parented to the rig (the hat / sword / parrot built
 * here) shouldn't be re-tinted, and skinned meshes are the easy
 * filter for "is this part of the body".
 */
function tintBodyMaterials(root: THREE.Object3D): RestoreEntry[] {
  const restore: RestoreEntry[] = [];
  root.traverse((child: THREE.Object3D) => {
    const skinned = child as THREE.SkinnedMesh;
    if (!skinned.isSkinnedMesh) return;
    const mats = Array.isArray(skinned.material)
      ? skinned.material
      : [skinned.material];
    for (const m of mats) {
      const mat = m as THREE.Material & { color?: THREE.Color };
      if (!mat?.color) continue;
      // Only tint each material once, even if it's reused across
      // multiple submeshes — restore would otherwise double-revert.
      if (restore.some((r) => r.mat === mat)) continue;
      restore.push({ mat, prevColor: mat.color.clone() });
      mat.color.multiply(BODY_TINT);
    }
  });
  return restore;
}

export function attachPirateOutfit(
  opts: AttachPirateOutfitOptions,
): PirateOutfit {
  const { root, scale = 1, tintBody = true } = opts;

  const geos: THREE.BufferGeometry[] = [];
  const mats: THREE.Material[] = [];
  const attached: THREE.Object3D[] = [];

  // ---- Hat + eyepatch on the head bone --------------------------------
  const head = findBone(root, /Head$/i);
  if (head) {
    const hat = buildTricornHat(geos, mats);
    hat.position.set(0, 14, 1);
    hat.rotation.set(-0.06, 0, 0);
    hat.scale.setScalar(scale);
    head.add(hat);
    attached.push(hat);

    const eyepatch = buildEyepatch(geos, mats);
    eyepatch.scale.setScalar(scale);
    head.add(eyepatch);
    attached.push(eyepatch);
  }

  // ---- Parrot on the left shoulder bone -------------------------------
  // Mixamo's "Shoulder" bone is the clavicle, anchored near the base of
  // the neck — perfect anchor for a parrot perched on the shoulder top
  // once we offset upward and outward into bone-local space.
  const leftShoulder = findBone(root, /LeftShoulder$/i);
  if (leftShoulder) {
    const parrot = buildParrot(geos, mats);
    // Bone-local axis convention varies between Mixamo exports — these
    // values are tuned for the samba_dancing.fbx rig the lead dancer
    // uses, putting the parrot at the top of the shoulder plate facing
    // forward.
    parrot.position.set(8, 4, 0);
    parrot.rotation.set(0, Math.PI / 2, 0);
    parrot.scale.setScalar(scale * 0.95);
    leftShoulder.add(parrot);
    attached.push(parrot);
  }

  // ---- Cutlass in the right hand --------------------------------------
  const rightHand = findBone(root, /RightHand$/i);
  if (rightHand) {
    const cutlass = buildCutlass(geos, mats);
    // Mixamo right-hand bone +Y points down the fingers, so positioning
    // the sword's handle origin slightly past the palm and rotating it
    // a bit lets the dancer "grip" the hilt.
    cutlass.position.set(2, 6, 1);
    cutlass.rotation.set(0, 0, -Math.PI / 2.1);
    cutlass.scale.setScalar(scale);
    rightHand.add(cutlass);
    attached.push(cutlass);
  }

  // ---- Sash across the torso ------------------------------------------
  // Spine2 is the upper-spine bone, just below the shoulders — anchors
  // the sash high on the chest so the diagonal really reads.
  const spine = findBone(root, /Spine2$/i) || findBone(root, /Spine1$/i);
  if (spine) {
    const sash = buildSash(geos, mats);
    sash.position.set(0, -8, 0);
    sash.scale.setScalar(scale);
    spine.add(sash);
    attached.push(sash);
  }

  // ---- Body tint (lead dancer only) -----------------------------------
  // Side dancers share materials with the source FBX via SkeletonUtils
  // .clone, so the lead's tint already shows on them. tintBody=false
  // skips the second pass for side dancers.
  const restore: RestoreEntry[] = tintBody ? tintBodyMaterials(root) : [];

  return {
    dispose() {
      for (const obj of attached) {
        obj.parent?.remove(obj);
      }
      for (const g of geos) g.dispose();
      for (const m of mats) m.dispose();
      for (const r of restore) {
        r.mat.color?.copy(r.prevColor);
      }
    },
  };
}
