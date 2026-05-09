import * as THREE from "three";

/**
 * The "old PC" hardware: a beige CRT monitor plus a stubby tower beside
 * it. All procedural — chassis box for the monitor body, a recessed
 * inset for the screen mount, a vent grille on the right cheek, a
 * little name-plate on the front, and a separate tower box with a
 * warm power-LED `PointLight` so it actually glows on the table top.
 *
 * The screen plane itself isn't built here — the host wires the
 * {@link CrtScreen} mesh into the recessed inset position returned by
 * {@link Pc.screenAnchor}. Keeping the screen separate lets it share
 * its own custom shader without worrying about the chassis material.
 */

export interface Pc {
  readonly object: THREE.Group;
  /** World-space position the CRT screen plane should sit at. */
  readonly screenAnchor: THREE.Vector3;
  /** Width of the inset the screen plane should match. */
  readonly screenWidth: number;
  /** Height of the inset the screen plane should match. */
  readonly screenHeight: number;
  setReducedMotion(reduced: boolean): void;
  tick(deltaSeconds: number): void;
  dispose(): void;
}

const BEIGE = new THREE.Color("#d8c79a");
const BEIGE_DARK = new THREE.Color("#b6a376");
const BEIGE_INSET = new THREE.Color("#241a0f");
const PLASTIC_ROUGHNESS = 0.78;

interface BuiltMaterial {
  material: THREE.MeshStandardMaterial;
}

function plasticMat(color: THREE.Color): BuiltMaterial {
  return {
    material: new THREE.MeshStandardMaterial({
      color,
      roughness: PLASTIC_ROUGHNESS,
      metalness: 0.04,
    }),
  };
}

export function createPc(): Pc {
  const group = new THREE.Group();
  group.name = "pc-chassis";

  const disposables: { dispose(): void }[] = [];
  function track<T extends { dispose(): void }>(thing: T): T {
    disposables.push(thing);
    return thing;
  }

  const monitorMat = track(plasticMat(BEIGE).material);
  const monitorDarkMat = track(plasticMat(BEIGE_DARK).material);
  const insetMat = track(
    new THREE.MeshStandardMaterial({
      color: BEIGE_INSET,
      roughness: 0.6,
      metalness: 0.05,
    }),
  );

  // ----- monitor body --------------------------------------------------
  // The body is a slightly-tapered box: wider at the back than the
  // front to read as a CRT tube. We fake the taper with a single
  // BoxGeometry whose front face will be hidden behind the bezel mesh.
  const bodyDepth = 1.0;
  const bodyWidth = 1.55;
  const bodyHeight = 1.2;
  const bodyGeo = track(new THREE.BoxGeometry(bodyWidth, bodyHeight, bodyDepth));
  const body = new THREE.Mesh(bodyGeo, monitorMat);
  body.position.set(0, bodyHeight / 2, -bodyDepth / 2 + 0.4);
  group.add(body);

  // Bezel: a thinner box in front of the body whose inset will hold the
  // screen plane. Same beige but a touch darker so the seam reads.
  const bezelDepth = 0.12;
  const bezelGeo = track(
    new THREE.BoxGeometry(bodyWidth + 0.04, bodyHeight + 0.04, bezelDepth),
  );
  const bezel = new THREE.Mesh(bezelGeo, monitorDarkMat);
  bezel.position.set(0, bodyHeight / 2, 0.4 + bezelDepth / 2);
  group.add(bezel);

  // Recessed screen inset: a slightly-smaller dark plane sitting just
  // behind where the screen will live, so the chamfer between bezel
  // and screen reads as a recess in the tube.
  const insetWidth = 1.18;
  const insetHeight = 0.92;
  const insetGeo = track(new THREE.PlaneGeometry(insetWidth + 0.06, insetHeight + 0.06));
  const inset = new THREE.Mesh(insetGeo, insetMat);
  inset.position.set(0, bodyHeight / 2, 0.4 + bezelDepth + 0.001);
  group.add(inset);

  // Name plate on the front bezel.
  const plateGeo = track(new THREE.PlaneGeometry(0.32, 0.06));
  const plateMat = track(
    new THREE.MeshStandardMaterial({
      color: new THREE.Color("#3a2c14"),
      roughness: 0.4,
      metalness: 0.6,
    }),
  );
  const plate = new THREE.Mesh(plateGeo, plateMat);
  plate.position.set(0.45, 0.18, 0.4 + bezelDepth + 0.002);
  group.add(plate);

  // Vent grille on the right cheek of the body — a series of recessed slats.
  const ventMat = track(
    new THREE.MeshStandardMaterial({
      color: new THREE.Color("#1a1308"),
      roughness: 0.9,
      metalness: 0.0,
    }),
  );
  const ventCount = 9;
  const ventGeo = track(new THREE.PlaneGeometry(0.42, 0.04));
  for (let i = 0; i < ventCount; i++) {
    const slat = new THREE.Mesh(ventGeo, ventMat);
    slat.rotation.y = Math.PI / 2;
    slat.position.set(
      bodyWidth / 2 + 0.001,
      bodyHeight / 2 - 0.3 + i * 0.06,
      -bodyDepth / 2 + 0.4 - 0.05,
    );
    group.add(slat);
  }

  // Power LED on the front bezel — small emissive dot.
  const ledMat = track(
    new THREE.MeshStandardMaterial({
      color: new THREE.Color("#552200"),
      emissive: new THREE.Color("#ff6a14"),
      emissiveIntensity: 1.2,
      roughness: 0.4,
      metalness: 0.2,
    }),
  );
  const ledGeo = track(new THREE.CircleGeometry(0.018, 24));
  const led = new THREE.Mesh(ledGeo, ledMat);
  led.position.set(-0.62, 0.2, 0.4 + bezelDepth + 0.003);
  group.add(led);

  // Stand: a short tapered neck plus a flared base.
  const neckGeo = track(new THREE.CylinderGeometry(0.18, 0.22, 0.12, 24));
  const neck = new THREE.Mesh(neckGeo, monitorDarkMat);
  neck.position.set(0, -0.06, 0);
  group.add(neck);
  const baseGeo = track(new THREE.CylinderGeometry(0.42, 0.45, 0.06, 28));
  const base = new THREE.Mesh(baseGeo, monitorMat);
  base.position.set(0, -0.15, 0);
  group.add(base);

  // ----- tower (squat box beside the monitor) -------------------------
  const tower = new THREE.Group();
  tower.position.set(1.6, 0, -0.3);
  group.add(tower);

  const towerGeo = track(new THREE.BoxGeometry(0.55, 0.8, 1.4));
  const towerBody = new THREE.Mesh(towerGeo, monitorMat);
  towerBody.position.set(0, 0.4, 0);
  tower.add(towerBody);

  // Floppy slot
  const slotGeo = track(new THREE.PlaneGeometry(0.32, 0.04));
  const slotMat = track(
    new THREE.MeshStandardMaterial({
      color: new THREE.Color("#0a0805"),
      roughness: 0.5,
    }),
  );
  const slot = new THREE.Mesh(slotGeo, slotMat);
  slot.position.set(0, 0.62, 0.701);
  tower.add(slot);

  // Tower power LED — green this time, the kind you remember.
  const towerLedMat = track(
    new THREE.MeshStandardMaterial({
      color: new THREE.Color("#08210e"),
      emissive: new THREE.Color("#22ff66"),
      emissiveIntensity: 1.6,
      roughness: 0.4,
    }),
  );
  const towerLedGeo = track(new THREE.CircleGeometry(0.014, 18));
  const towerLed = new THREE.Mesh(towerLedGeo, towerLedMat);
  towerLed.position.set(0.12, 0.42, 0.701);
  tower.add(towerLed);

  // A tiny warm point light behind the tower's LED so the table top
  // picks up the colour. Very low intensity so it doesn't fight the
  // candles.
  const towerLight = new THREE.PointLight(0x22ff66, 0.45, 1.2, 1.6);
  towerLight.position.set(1.7, 0.42, 0.45);
  group.add(towerLight);

  const screenAnchor = new THREE.Vector3(0, bodyHeight / 2, 0.4 + bezelDepth + 0.004);

  let reduced = false;

  return {
    object: group,
    screenAnchor,
    screenWidth: insetWidth,
    screenHeight: insetHeight,
    setReducedMotion(v: boolean) {
      reduced = v;
    },
    tick(_delta: number) {
      // Tower LED gently breathes when motion is allowed — sells the
      // "machine is alive" feeling without demanding attention.
      if (reduced) {
        towerLedMat.emissiveIntensity = 1.6;
        return;
      }
      const t = performance.now() / 1000;
      towerLedMat.emissiveIntensity = 1.4 + 0.2 * Math.sin(t * 1.2);
    },
    dispose() {
      for (const d of disposables) d.dispose();
    },
  };
}
