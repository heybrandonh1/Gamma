import * as THREE from "three";

/**
 * Birthday cake hat: a three-tier frosted cake worn on the dancer's head.
 *
 * Stack (bottom → top):
 *   1. Wide pink-frosting base tier
 *   2. White-frosting middle tier with a magenta drip ring at its rim
 *   3. Chocolate top tier with a white drip ring + scattered sprinkles
 *   4. Five candles around the top tier, each with a small emissive flame
 *
 * Sized for a Mixamo head bone (~25 units across). Returns one Group ready
 * to be `head.add()`-ed and an explicit dispose() to free GPU memory on
 * unmount.
 *
 * The export name is kept as `buildPartyHat` for backwards compatibility
 * with the rest of the disco-dancer module — the hat is just the cake
 * variant of "party hat" now.
 */

interface BuiltCake {
  group: THREE.Group;
  geometries: THREE.BufferGeometry[];
  materials: THREE.Material[];
}

/**
 * Sprinkle colors — bright party hues so the chocolate top reads as
 * "decorated", not just brown. Picked to also pop against the UV floor.
 */
const SPRINKLE_COLORS = [
  0xff3366, 0xffd23f, 0x2dd4bf, 0x6366f1, 0xff66cc, 0x33ff99,
];

/**
 * Candle wax colors. Cycled around the ring so adjacent candles never
 * share a color.
 */
const CANDLE_COLORS = [0xff5f8a, 0x6ec1ff, 0xffd86b, 0x9d6bff, 0x6bff9d];

/**
 * Build the cake into a freshly-created group. Pulled out of the public
 * function so the optional `scale` parameter (used by the side dancers
 * for slightly smaller cakes) can scale the whole stack uniformly without
 * re-deriving every constant.
 */
function buildCake(): BuiltCake {
  const group = new THREE.Group();
  group.name = "disco-dancer-birthday-cake-hat";

  const geometries: THREE.BufferGeometry[] = [];
  const materials: THREE.Material[] = [];

  /** Helper to register a mesh's geo/mat for later disposal. */
  function track(geo: THREE.BufferGeometry, mat: THREE.Material) {
    geometries.push(geo);
    materials.push(mat);
  }

  // ---- Tier 1 (bottom): pink frosting ----------------------------------
  const tier1Geo = new THREE.CylinderGeometry(11, 11, 6, 40);
  const tier1Mat = new THREE.MeshPhysicalMaterial({
    color: 0xffb3d1,
    roughness: 0.45,
    metalness: 0.0,
    clearcoat: 0.6,
    clearcoatRoughness: 0.25,
    sheen: 0.4,
    sheenColor: new THREE.Color(0xffe2ee),
  });
  const tier1 = new THREE.Mesh(tier1Geo, tier1Mat);
  tier1.position.y = 3;
  tier1.castShadow = true;
  tier1.receiveShadow = true;
  group.add(tier1);
  track(tier1Geo, tier1Mat);

  // White drip ring sitting on the top edge of the bottom tier — fakes
  // the look of frosting that ran over the rim and pooled.
  const drip1Geo = new THREE.TorusGeometry(11, 1.1, 12, 48);
  const drip1Mat = new THREE.MeshPhysicalMaterial({
    color: 0xfff8f0,
    roughness: 0.35,
    metalness: 0.0,
    clearcoat: 0.7,
    clearcoatRoughness: 0.18,
  });
  const drip1 = new THREE.Mesh(drip1Geo, drip1Mat);
  drip1.position.y = 5.7;
  drip1.rotation.x = Math.PI / 2;
  drip1.castShadow = true;
  group.add(drip1);
  track(drip1Geo, drip1Mat);

  // ---- Tier 2 (middle): white frosting ---------------------------------
  const tier2Geo = new THREE.CylinderGeometry(7.2, 7.5, 5, 36);
  const tier2Mat = new THREE.MeshPhysicalMaterial({
    color: 0xfff5ea,
    roughness: 0.4,
    metalness: 0.0,
    clearcoat: 0.7,
    clearcoatRoughness: 0.2,
    sheen: 0.3,
    sheenColor: new THREE.Color(0xffe9d6),
  });
  const tier2 = new THREE.Mesh(tier2Geo, tier2Mat);
  tier2.position.y = 8.7;
  tier2.castShadow = true;
  tier2.receiveShadow = true;
  group.add(tier2);
  track(tier2Geo, tier2Mat);

  // Magenta drip on the white tier — pops against the cream frosting and
  // ties the cake into the UV floor's palette.
  const drip2Geo = new THREE.TorusGeometry(7.2, 0.85, 12, 40);
  const drip2Mat = new THREE.MeshPhysicalMaterial({
    color: 0xff3da3,
    emissive: 0x4a0028,
    emissiveIntensity: 0.4,
    roughness: 0.3,
    metalness: 0.05,
    clearcoat: 0.8,
    clearcoatRoughness: 0.12,
  });
  const drip2 = new THREE.Mesh(drip2Geo, drip2Mat);
  drip2.position.y = 10.95;
  drip2.rotation.x = Math.PI / 2;
  drip2.castShadow = true;
  group.add(drip2);
  track(drip2Geo, drip2Mat);

  // ---- Tier 3 (top): chocolate -----------------------------------------
  const tier3Geo = new THREE.CylinderGeometry(4.0, 4.3, 4, 32);
  const tier3Mat = new THREE.MeshPhysicalMaterial({
    color: 0x5a3318,
    roughness: 0.55,
    metalness: 0.0,
    clearcoat: 0.4,
    clearcoatRoughness: 0.35,
  });
  const tier3 = new THREE.Mesh(tier3Geo, tier3Mat);
  tier3.position.y = 13.4;
  tier3.castShadow = true;
  tier3.receiveShadow = true;
  group.add(tier3);
  track(tier3Geo, tier3Mat);

  // Tiny white drip on the chocolate top — splash of contrast.
  const drip3Geo = new THREE.TorusGeometry(4.0, 0.55, 10, 32);
  const drip3Mat = new THREE.MeshPhysicalMaterial({
    color: 0xfff8f0,
    roughness: 0.3,
    metalness: 0.0,
    clearcoat: 0.7,
    clearcoatRoughness: 0.15,
  });
  const drip3 = new THREE.Mesh(drip3Geo, drip3Mat);
  drip3.position.y = 14.7;
  drip3.rotation.x = Math.PI / 2;
  group.add(drip3);
  track(drip3Geo, drip3Mat);

  // ---- Sprinkles on the chocolate tier ---------------------------------
  // Stubby capsule-ish little cylinders laid roughly tangent to the top
  // surface, biased to avoid the candle ring (radius < 2.4) so the
  // sprinkles read as decoration around — not under — the candles.
  const sprinkleGeo = new THREE.CylinderGeometry(0.18, 0.18, 0.9, 6);
  for (let i = 0; i < 18; i++) {
    const r = 0.6 + Math.random() * 1.7;
    const theta = Math.random() * Math.PI * 2;
    const color = SPRINKLE_COLORS[i % SPRINKLE_COLORS.length];
    const sprinkleMat = new THREE.MeshStandardMaterial({
      color,
      emissive: color,
      emissiveIntensity: 0.25,
      roughness: 0.4,
      metalness: 0.05,
    });
    const sprinkle = new THREE.Mesh(sprinkleGeo, sprinkleMat);
    sprinkle.position.set(
      Math.cos(theta) * r,
      15.45,
      Math.sin(theta) * r,
    );
    // Random tilt so the sprinkles look scattered, not radially placed.
    sprinkle.rotation.set(
      Math.PI / 2 + (Math.random() - 0.5) * 0.4,
      theta + Math.random() * 0.6,
      0,
    );
    group.add(sprinkle);
    materials.push(sprinkleMat);
  }
  geometries.push(sprinkleGeo);

  // ---- Candles: 5 around the top tier ----------------------------------
  const candleGeo = new THREE.CylinderGeometry(0.55, 0.6, 4.4, 14);
  const wickGeo = new THREE.CylinderGeometry(0.08, 0.08, 0.5, 6);
  const wickMat = new THREE.MeshStandardMaterial({
    color: 0x1a1208,
    roughness: 0.9,
    metalness: 0.0,
  });
  const flameGeo = new THREE.ConeGeometry(0.38, 1.2, 12);
  geometries.push(candleGeo, wickGeo, flameGeo);
  materials.push(wickMat);

  for (let i = 0; i < CANDLE_COLORS.length; i++) {
    const theta = (i / CANDLE_COLORS.length) * Math.PI * 2;
    const candleColor = CANDLE_COLORS[i];

    // Candle wax — slightly emissive so it picks up a touch of its own
    // flame's color, which sells the "lit candle" read.
    const candleMat = new THREE.MeshPhysicalMaterial({
      color: candleColor,
      emissive: candleColor,
      emissiveIntensity: 0.18,
      roughness: 0.4,
      metalness: 0.0,
      clearcoat: 0.3,
      clearcoatRoughness: 0.3,
    });
    const candle = new THREE.Mesh(candleGeo, candleMat);
    candle.position.set(Math.cos(theta) * 2.1, 17.7, Math.sin(theta) * 2.1);
    candle.castShadow = true;
    group.add(candle);
    materials.push(candleMat);

    // Wick on top of the candle.
    const wick = new THREE.Mesh(wickGeo, wickMat);
    wick.position.y = 2.45;
    candle.add(wick);

    // Flame — strong emissive yellow-orange, drawn additively so it punches
    // through the lighting without needing a real light source per candle.
    // Keep depthWrite off so the flames don't carve a hole in the cake when
    // viewed from behind.
    const flameMat = new THREE.MeshBasicMaterial({
      color: 0xffce4d,
      transparent: true,
      opacity: 0.95,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });
    const flame = new THREE.Mesh(flameGeo, flameMat);
    flame.position.y = 3.4;
    candle.add(flame);
    materials.push(flameMat);

    // Inner brighter core — smaller cone overlaid with stronger emissive
    // so the flame's heart looks white-hot. Reuses the same geometry,
    // just scaled down.
    const flameCoreMat = new THREE.MeshBasicMaterial({
      color: 0xffffff,
      transparent: true,
      opacity: 0.85,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });
    const flameCore = new THREE.Mesh(flameGeo, flameCoreMat);
    flameCore.position.y = 3.25;
    flameCore.scale.set(0.45, 0.65, 0.45);
    candle.add(flameCore);
    materials.push(flameCoreMat);
  }

  return { group, geometries, materials };
}

/**
 * Build a birthday cake hat. `scale` uniformly scales the whole stack —
 * use values < 1 for the smaller side dancers so their cakes don't
 * overpower the lead dancer's.
 */
export function buildPartyHat(scale = 1): {
  group: THREE.Group;
  dispose: () => void;
} {
  const built = buildCake();
  if (scale !== 1) built.group.scale.setScalar(scale);

  return {
    group: built.group,
    dispose: () => {
      for (const g of built.geometries) g.dispose();
      for (const m of built.materials) m.dispose();
    },
  };
}
