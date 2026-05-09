import * as THREE from "three";

/**
 * The keyboard + mouse that sit on the wizard's table in front of the
 * CRT, plus the cable that runs from the back of the mouse over to the
 * tower.
 *
 * Built procedurally in the same beige / cream palette as the
 * {@link Pc} chassis. Everything lives in PC-local space — the host
 * adds this group as a child of the PC group so the small
 * `Math.PI * 0.05` rotation applied to the chassis carries through and
 * the desk reads as one assembled set, not three pieces dropped at
 * world origin.
 *
 * Subsystems:
 *   - Keyboard: a low slab with a slightly darker bezel rim, a 5×14
 *     grid of individual key cubes (the bottom row has two single
 *     keys at each end and a 10-key-wide centred space bar instead of
 *     individual letters), and a tiny green status LED above the
 *     upper-right corner that breathes in time with the tower's
 *     power LED.
 *   - Mouse: a squashed ellipsoid body, two button caps split by a
 *     thin gap, and a slim scroll wheel between them.
 *   - Cable: a CatmullRom-driven `TubeGeometry` that arcs out the back
 *     of the mouse, lifts a few centimetres above the table mid-run
 *     (so it reads as cable stiffness rather than a straight line),
 *     and lands at a small port plug glued to the lower-left side of
 *     the tower.
 */

export interface Peripherals {
  readonly object: THREE.Group;
  setReducedMotion(reduced: boolean): void;
  tick(deltaSeconds: number): void;
  dispose(): void;
}

export interface CreatePeripheralsArgs {
  /**
   * PC-local Y of the table surface — i.e. the height at which the
   * gear should rest. The tower's bottom face sits at PC-local y=0,
   * so passing 0 keeps the keyboard / mouse flush with it.
   */
  tableY: number;
  /**
   * PC-local point where the cable should plug into the tower. A small
   * "port plug" cylinder is added at this position so the cable
   * doesn't look like it's stabbed into a flat plastic face.
   */
  towerCablePort: THREE.Vector3;
}

const BEIGE = new THREE.Color("#d8c79a");
const BEIGE_DARK = new THREE.Color("#b6a376");
const KEY_BEIGE = new THREE.Color("#e6d6aa");
const PLASTIC_ROUGHNESS = 0.78;

export function createPeripherals(args: CreatePeripheralsArgs): Peripherals {
  const { tableY, towerCablePort } = args;
  const group = new THREE.Group();
  group.name = "pc-peripherals";

  const disposables: { dispose(): void }[] = [];
  function track<T extends { dispose(): void }>(thing: T): T {
    disposables.push(thing);
    return thing;
  }

  const trayMat = track(
    new THREE.MeshStandardMaterial({
      color: BEIGE,
      roughness: PLASTIC_ROUGHNESS,
      metalness: 0.04,
    }),
  );
  const trayDarkMat = track(
    new THREE.MeshStandardMaterial({
      color: BEIGE_DARK,
      roughness: PLASTIC_ROUGHNESS,
      metalness: 0.04,
    }),
  );
  const keyMat = track(
    new THREE.MeshStandardMaterial({
      color: KEY_BEIGE,
      roughness: 0.6,
      metalness: 0.03,
    }),
  );
  const wheelMat = track(
    new THREE.MeshStandardMaterial({
      color: new THREE.Color("#1a1308"),
      roughness: 0.6,
    }),
  );

  // ----- keyboard -----------------------------------------------------
  // 5×14 grid is roomy enough to read as a real layout from the orbit
  // distance OrbitControls allows (`minDistance: 2.2`) without paying
  // for a literal 104-key board.
  const KEY_COLS = 14;
  const KEY_ROWS = 5;
  const KEY_W = 0.075;
  const KEY_H = 0.025;
  const KEY_GAP = 0.012;
  const TRAY_PADDING = 0.06;

  const gridW = KEY_COLS * KEY_W + (KEY_COLS - 1) * KEY_GAP;
  const gridD = KEY_ROWS * KEY_W + (KEY_ROWS - 1) * KEY_GAP;
  const trayW = gridW + TRAY_PADDING * 2;
  const trayD = gridD + TRAY_PADDING * 2;
  const trayBaseH = 0.05;

  const keyboard = new THREE.Group();
  keyboard.name = "keyboard";
  // Slightly to the left so the mouse fits comfortably between the
  // keyboard's right edge and the tower without crowding either.
  keyboard.position.set(-0.1, tableY, 1.25);
  // ~5° back tilt — every wedge keyboard sits this way; lifts the
  // front of the tray by sin(0.085) * trayD/2 ≈ 2 cm, which the
  // viewer reads as a real keyboard angle rather than a flat plate.
  keyboard.rotation.x = 0.085;
  group.add(keyboard);

  const trayBaseGeo = track(new THREE.BoxGeometry(trayW, trayBaseH, trayD));
  const trayBase = new THREE.Mesh(trayBaseGeo, trayMat);
  trayBase.position.set(0, trayBaseH / 2, 0);
  keyboard.add(trayBase);

  // Bezel: a thin, slightly larger, slightly darker plate that hugs
  // the base so the candle highlights catch a seam between the two
  // mouldings instead of one solid beige slab.
  const bezelGeo = track(
    new THREE.BoxGeometry(trayW + 0.02, trayBaseH * 0.5, trayD + 0.02),
  );
  const bezel = new THREE.Mesh(bezelGeo, trayDarkMat);
  bezel.position.set(0, trayBaseH * 0.25, 0);
  keyboard.add(bezel);

  // Key grid. The top four rows are a uniform field; the bottom row
  // gets a wide centred space bar with two single keys at each end
  // (ctrl / alt-style) so the silhouette reads as a real keyboard
  // even from the auto-rotating distance.
  const keyGeo = track(new THREE.BoxGeometry(KEY_W, KEY_H, KEY_W));
  const gridX0 = -gridW / 2 + KEY_W / 2;
  const gridZ0 = -gridD / 2 + KEY_W / 2;
  const keyTopY = trayBaseH + KEY_H / 2;

  for (let r = 0; r < KEY_ROWS - 1; r++) {
    for (let c = 0; c < KEY_COLS; c++) {
      const key = new THREE.Mesh(keyGeo, keyMat);
      key.position.set(
        gridX0 + c * (KEY_W + KEY_GAP),
        keyTopY,
        gridZ0 + r * (KEY_W + KEY_GAP),
      );
      keyboard.add(key);
    }
  }

  const bottomZ = gridZ0 + (KEY_ROWS - 1) * (KEY_W + KEY_GAP);
  for (let i = 0; i < 2; i++) {
    const left = new THREE.Mesh(keyGeo, keyMat);
    left.position.set(gridX0 + i * (KEY_W + KEY_GAP), keyTopY, bottomZ);
    keyboard.add(left);
    const right = new THREE.Mesh(keyGeo, keyMat);
    right.position.set(
      gridX0 + (KEY_COLS - 1 - i) * (KEY_W + KEY_GAP),
      keyTopY,
      bottomZ,
    );
    keyboard.add(right);
  }
  const spaceCols = KEY_COLS - 4;
  const spaceW = spaceCols * KEY_W + (spaceCols - 1) * KEY_GAP;
  const spaceGeo = track(new THREE.BoxGeometry(spaceW, KEY_H, KEY_W));
  const space = new THREE.Mesh(spaceGeo, keyMat);
  space.position.set(
    gridX0 + ((KEY_COLS - 1) / 2) * (KEY_W + KEY_GAP),
    keyTopY,
    bottomZ,
  );
  keyboard.add(space);

  // Status LED — small green emissive disc up by the tray's
  // upper-right corner. Gently breathes (in tick) so the keyboard
  // feels powered, in time with the tower's own power LED.
  const ledGeo = track(new THREE.CircleGeometry(0.012, 18));
  const ledMat = track(
    new THREE.MeshStandardMaterial({
      color: new THREE.Color("#08210e"),
      emissive: new THREE.Color("#22ff66"),
      emissiveIntensity: 1.2,
      roughness: 0.4,
    }),
  );
  const led = new THREE.Mesh(ledGeo, ledMat);
  led.rotation.x = -Math.PI / 2;
  led.position.set(trayW / 2 - 0.06, trayBaseH + 0.001, -trayD / 2 + 0.04);
  keyboard.add(led);

  // ----- mouse --------------------------------------------------------
  const mouse = new THREE.Group();
  mouse.name = "mouse";
  // Right of the keyboard, comfortable hand distance.
  mouse.position.set(0.85, tableY, 1.25);
  // Slight inward yaw so the mouse points toward the user, not square
  // to the table grid — sells the "set down mid-game" pose.
  mouse.rotation.y = -0.18;
  group.add(mouse);

  // Body: a half-sphere stretched along Z into a teardrop. Scaling
  // a sphere is cheaper than authoring a custom geometry and reads
  // identically once the chassis material catches the candles.
  const bodyGeo = track(new THREE.SphereGeometry(0.11, 24, 16));
  const body = new THREE.Mesh(bodyGeo, trayMat);
  body.scale.set(1.0, 0.55, 1.4);
  body.position.set(0, 0.05, 0);
  mouse.add(body);

  // Two button caps on top, split by the thin ridge between them.
  const buttonGeo = track(new THREE.BoxGeometry(0.045, 0.012, 0.13));
  const leftBtn = new THREE.Mesh(buttonGeo, keyMat);
  leftBtn.position.set(-0.025, 0.114, 0.018);
  mouse.add(leftBtn);
  const rightBtn = new THREE.Mesh(buttonGeo, keyMat);
  rightBtn.position.set(0.025, 0.114, 0.018);
  mouse.add(rightBtn);

  // Scroll wheel: a thin torus between the buttons, oriented so its
  // axis runs left/right (the way a real wheel turns under your
  // fingertip).
  const wheelGeo = track(new THREE.TorusGeometry(0.011, 0.005, 8, 18));
  const wheel = new THREE.Mesh(wheelGeo, wheelMat);
  wheel.position.set(0, 0.122, 0.05);
  wheel.rotation.y = Math.PI / 2;
  mouse.add(wheel);

  // ----- cable: mouse -> tower ---------------------------------------
  // Compute the cable start in PC-local space by rotating the
  // mouse-back offset (which lives in mouse-local space) through the
  // mouse's yaw and adding the mouse's local position.
  const mouseBackLocal = new THREE.Vector3(0, 0.06, -0.13);
  mouseBackLocal.applyEuler(mouse.rotation);
  const cableStart = mouse.position.clone().add(mouseBackLocal);
  const cableEnd = towerCablePort.clone();

  // Two intermediate control points lift the cable a few cm above
  // the table so it reads as a stiff PS/2-era cable rather than a
  // straight line laid flat on the wood. Tension 0.5 keeps the curve
  // smooth without overshooting back below the table.
  const cableMidA = cableStart.clone().lerp(cableEnd, 0.35);
  cableMidA.y = Math.max(cableStart.y, cableEnd.y) + 0.06;
  const cableMidB = cableStart.clone().lerp(cableEnd, 0.7);
  cableMidB.y = Math.max(cableStart.y, cableEnd.y) + 0.04;

  const curve = new THREE.CatmullRomCurve3(
    [cableStart, cableMidA, cableMidB, cableEnd],
    false,
    "catmullrom",
    0.5,
  );
  const cableGeo = track(new THREE.TubeGeometry(curve, 48, 0.012, 8, false));
  const cableMat = track(
    new THREE.MeshStandardMaterial({
      color: new THREE.Color("#c8b889"),
      roughness: 0.85,
      metalness: 0.04,
    }),
  );
  const cable = new THREE.Mesh(cableGeo, cableMat);
  group.add(cable);

  // Small port plug glued to the tower at the cable's endpoint so
  // the tube doesn't visually disappear into a flat plastic face.
  const plugGeo = track(new THREE.CylinderGeometry(0.022, 0.022, 0.04, 12));
  const plug = new THREE.Mesh(plugGeo, trayDarkMat);
  plug.position.copy(cableEnd);
  // Orient the plug along the cable's incoming tangent so it reads
  // as a connector, not a coin glued to the side of the tower.
  const tangent = curve.getTangent(1).normalize();
  const up = new THREE.Vector3(0, 1, 0);
  const q = new THREE.Quaternion().setFromUnitVectors(up, tangent);
  plug.quaternion.copy(q);
  group.add(plug);

  let reduced = false;

  return {
    object: group,
    setReducedMotion(v: boolean) {
      reduced = v;
      if (reduced) ledMat.emissiveIntensity = 1.2;
    },
    tick(_delta: number) {
      // Phase-shift the breathe so the keyboard LED isn't perfectly
      // synced with the tower's — keeps the desk from looking like
      // one strobing unit.
      if (reduced) {
        ledMat.emissiveIntensity = 1.2;
        return;
      }
      const t = performance.now() / 1000;
      ledMat.emissiveIntensity = 1.0 + 0.2 * Math.sin(t * 1.2 + 0.6);
    },
    dispose() {
      for (const d of disposables) d.dispose();
    },
  };
}
