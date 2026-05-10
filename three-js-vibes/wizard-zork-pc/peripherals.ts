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
 *     the tower. Rebuilt each frame so it follows the mouse end as
 *     it floats.
 *
 * Ghostly float:
 *   The keyboard and mouse never actually sit on the table — they
 *   hover ~4 cm above it and drift continuously in 3D space, the way
 *   a possessed object on a wizard's desk should. Each axis (x, y, z
 *   position; pitch, yaw, roll rotation) is driven by a sum of three
 *   sine waves at irrationally-related frequencies (0.61 / 0.97 /
 *   1.43 Hz, weighted 0.55 / 0.30 / 0.15). Different per-axis seeds
 *   on the keyboard vs mouse mean the two items never bob in
 *   lockstep, and the lack of a fundamental period keeps the motion
 *   from visibly looping back on itself.
 *
 *   Y motion dominates ("up / down" is the main read), with smaller
 *   X / Z drift on top so the silhouette also wanders left / right /
 *   forward / back. Rotation wobble is bounded at ~2-3° so the items
 *   tilt gently without ever flipping. Under `prefers-reduced-motion`
 *   both items pin to a still hover at the centre of the float
 *   envelope — no oscillation, but still off the table, in keeping
 *   with the ghostly read.
 */

export interface Peripherals {
  readonly object: THREE.Group;
  setReducedMotion(reduced: boolean): void;
  tick(deltaSeconds: number): void;
  dispose(): void;
}

export interface CreatePeripheralsArgs {
  /**
   * PC-local Y of the table surface. The tower's bottom face sits at
   * PC-local y=0, so passing 0 aligns the float envelope with the
   * tower's footprint. The keyboard and mouse hover roughly 4 cm
   * above this value (see `HOVER_Y` in the impl) and never actually
   * touch down.
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

  // Average hover height above the table. Both items orbit this
  // value continuously in `tick` — they never actually touch down,
  // which is what gives the desk its possessed / ghostly feel.
  const HOVER_Y = 0.04;

  const keyboard = new THREE.Group();
  keyboard.name = "keyboard";
  // Slightly to the left so the mouse fits comfortably between the
  // keyboard's right edge and the tower without crowding either.
  keyboard.position.set(-0.1, tableY + HOVER_Y, 1.25);
  // ~5° back tilt — every wedge keyboard sits this way; lifts the
  // front of the tray by sin(0.085) * trayD/2 ≈ 2 cm, which the
  // viewer reads as a real keyboard angle rather than a flat plate.
  keyboard.rotation.x = 0.085;
  group.add(keyboard);

  // Cache the keyboard's float-centre pose. The continuous-drift
  // animation in `tick` adds organic offsets on top of these and
  // snaps back to them under `prefers-reduced-motion`.
  const keyboardRestX = keyboard.position.x;
  const keyboardRestY = keyboard.position.y;
  const keyboardRestZ = keyboard.position.z;
  const keyboardRestRotX = keyboard.rotation.x;

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
  // Right of the keyboard, comfortable hand distance — same hover
  // height as the keyboard so the desk reads as one floating set.
  mouse.position.set(0.85, tableY + HOVER_Y, 1.25);
  // Slight inward yaw so the mouse points toward the user, not square
  // to the table grid — sells the "set down mid-game" pose, even
  // though it's actually never set down.
  mouse.rotation.y = -0.18;
  group.add(mouse);

  // Mouse float-centre pose, same idea as the keyboard's cache.
  const mouseRestX = mouse.position.x;
  const mouseRestY = mouse.position.y;
  const mouseRestZ = mouse.position.z;
  const mouseRestRotY = mouse.rotation.y;

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
  // Curve control points are kept in a mutable array so the cable
  // can be rebuilt each frame as the mouse floats up and back down.
  // Allocating once and mutating in place keeps the float animation
  // out of the GC's way.
  const CABLE_BACK_OFFSET = new THREE.Vector3(0, 0.06, -0.13);
  const cableStart = new THREE.Vector3();
  const cableMidA = new THREE.Vector3();
  const cableMidB = new THREE.Vector3();
  const cableEnd = towerCablePort.clone();
  const cablePoints: THREE.Vector3[] = [
    cableStart,
    cableMidA,
    cableMidB,
    cableEnd,
  ];
  const cableCurve = new THREE.CatmullRomCurve3(
    cablePoints,
    false,
    "catmullrom",
    0.5,
  );
  const _scratchBack = new THREE.Vector3();

  // Recomputes the cable's four control points based on the mouse's
  // current pose. Two intermediate points sit a few cm above the
  // start/end so the cable reads as a stiff PS/2-era cable rather
  // than a slack line — and so the arc lifts naturally with the
  // mouse when the witch picks it up.
  function updateCablePoints(): void {
    _scratchBack.copy(CABLE_BACK_OFFSET).applyEuler(mouse.rotation);
    cableStart.copy(mouse.position).add(_scratchBack);
    cableMidA.lerpVectors(cableStart, cableEnd, 0.35);
    cableMidA.y = Math.max(cableStart.y, cableEnd.y) + 0.06;
    cableMidB.lerpVectors(cableStart, cableEnd, 0.7);
    cableMidB.y = Math.max(cableStart.y, cableEnd.y) + 0.04;
  }

  updateCablePoints();
  // Cable geometry is *not* added to `disposables` because the float
  // animation swaps it out each frame. The latest mesh.geometry is
  // disposed explicitly in this subsystem's own `dispose()`.
  const cableMat = track(
    new THREE.MeshStandardMaterial({
      color: new THREE.Color("#c8b889"),
      roughness: 0.85,
      metalness: 0.04,
    }),
  );
  const cable = new THREE.Mesh(
    new THREE.TubeGeometry(cableCurve, 48, 0.012, 8, false),
    cableMat,
  );
  group.add(cable);

  // Small port plug glued to the tower at the cable's endpoint so
  // the tube doesn't visually disappear into a flat plastic face.
  // The plug stays put while the cable end at the mouse animates.
  const plugGeo = track(new THREE.CylinderGeometry(0.022, 0.022, 0.04, 12));
  const plug = new THREE.Mesh(plugGeo, trayDarkMat);
  plug.position.copy(cableEnd);
  const initialTangent = cableCurve.getTangent(1).normalize();
  const up = new THREE.Vector3(0, 1, 0);
  const q = new THREE.Quaternion().setFromUnitVectors(up, initialTangent);
  plug.quaternion.copy(q);
  group.add(plug);

  // ----- ghostly float animation -------------------------------------
  // Per-axis amplitudes for the keyboard and mouse. Y leads ("up /
  // down" is the dominant read), X is clearly visible ("left / right"
  // drift), Z is subtler ("forward / back"). Rotation amplitudes are
  // all bounded under ~3.5° so the items tilt gently without ever
  // looking like they're flipping.
  const KB_AMP_X = 0.018;
  const KB_AMP_Y = 0.030;
  const KB_AMP_Z = 0.010;
  const KB_AMP_ROT_X = 0.025;
  const KB_AMP_ROT_Y = 0.022;
  const KB_AMP_ROT_Z = 0.030;

  const MS_AMP_X = 0.014;
  const MS_AMP_Y = 0.028;
  const MS_AMP_Z = 0.012;
  const MS_AMP_ROT_X = 0.022;
  const MS_AMP_ROT_Y = 0.045;
  const MS_AMP_ROT_Z = 0.038;

  /**
   * Sum of three sine waves at irrationally-related frequencies with
   * a per-axis seed. Output is bounded in `[-1, 1]` (max sum of
   * weights is 0.55 + 0.30 + 0.15 = 1.0) but typical RMS is ~0.45,
   * so the visual motion sits comfortably below the configured
   * amplitude with occasional fuller swings.
   *
   * Frequencies (~0.61 / 0.97 / 1.43 Hz) are slow enough that the
   * motion reads as ghostly hover rather than vibration, and their
   * irrational ratios keep the wave from looping back on itself for
   * many minutes — so a viewer never sees the same pose twice.
   */
  function organicNoise(t: number, seed: number): number {
    return (
      Math.sin(t * 0.61 + seed * 1.7) * 0.55 +
      Math.sin(t * 0.97 + seed * 2.3) * 0.30 +
      Math.sin(t * 1.43 + seed * 0.7) * 0.15
    );
  }

  let reduced = false;

  // Pin both items to the centre of the float envelope (still off
  // the table — the ghostly read survives even without animation)
  // and rebuild the cable once so its arc matches.
  function settleToCentre(): void {
    keyboard.position.set(keyboardRestX, keyboardRestY, keyboardRestZ);
    keyboard.rotation.x = keyboardRestRotX;
    keyboard.rotation.y = 0;
    keyboard.rotation.z = 0;
    mouse.position.set(mouseRestX, mouseRestY, mouseRestZ);
    mouse.rotation.x = 0;
    mouse.rotation.y = mouseRestRotY;
    mouse.rotation.z = 0;
    updateCablePoints();
    cable.geometry.dispose();
    cable.geometry = new THREE.TubeGeometry(cableCurve, 48, 0.012, 8, false);
  }

  return {
    object: group,
    setReducedMotion(v: boolean) {
      reduced = v;
      if (reduced) {
        ledMat.emissiveIntensity = 1.2;
        settleToCentre();
      }
    },
    tick(_delta: number) {
      if (reduced) {
        ledMat.emissiveIntensity = 1.2;
        return;
      }
      const t = performance.now() / 1000;

      // Phase-shift the breathe so the keyboard LED isn't perfectly
      // synced with the tower's — keeps the desk from looking like
      // one strobing unit.
      ledMat.emissiveIntensity = 1.0 + 0.2 * Math.sin(t * 1.2 + 0.6);

      // Keyboard ghostly drift. Per-axis seeds are spaced widely so
      // x / y / z / pitch / yaw / roll all evolve on their own
      // schedule — no two axes peak together.
      keyboard.position.x = keyboardRestX + KB_AMP_X * organicNoise(t, 2.3);
      keyboard.position.y = keyboardRestY + KB_AMP_Y * organicNoise(t, 1.1);
      keyboard.position.z = keyboardRestZ + KB_AMP_Z * organicNoise(t, 3.7);
      keyboard.rotation.x =
        keyboardRestRotX + KB_AMP_ROT_X * organicNoise(t, 4.5);
      keyboard.rotation.y = KB_AMP_ROT_Y * organicNoise(t, 5.9);
      keyboard.rotation.z = KB_AMP_ROT_Z * organicNoise(t, 7.1);

      // Mouse ghostly drift. Seeds shifted into a separate band
      // (11+) so the mouse and keyboard never share a wave and
      // the desk reads as two independently possessed objects.
      mouse.position.x = mouseRestX + MS_AMP_X * organicNoise(t, 11.1);
      mouse.position.y = mouseRestY + MS_AMP_Y * organicNoise(t, 12.3);
      mouse.position.z = mouseRestZ + MS_AMP_Z * organicNoise(t, 13.7);
      mouse.rotation.x = MS_AMP_ROT_X * organicNoise(t, 14.5);
      mouse.rotation.y = mouseRestRotY + MS_AMP_ROT_Y * organicNoise(t, 15.9);
      mouse.rotation.z = MS_AMP_ROT_Z * organicNoise(t, 17.1);

      // Cable follows the mouse end. A 4-point CatmullRom curve at
      // 48 longitudinal segments x 8 radial = ~400 vertices — cheap
      // to rebuild every frame, simpler than mutating the existing
      // BufferAttributes in place because TubeGeometry has to
      // recompute Frenet frames on the new path anyway.
      updateCablePoints();
      cable.geometry.dispose();
      cable.geometry = new THREE.TubeGeometry(cableCurve, 48, 0.012, 8, false);
    },
    dispose() {
      for (const d of disposables) d.dispose();
      cable.geometry.dispose();
    },
  };
}
