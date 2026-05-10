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
 * Possession ritual:
 *   On a long ~18 s loop the keyboard and mouse start firm on the
 *   table, then a slow smoothstep rise lifts them all the way up to
 *   roughly the middle of the CRT screen (~55 cm in scene units —
 *   the monitor body is 1.2 units tall). They hover up there for a
 *   few seconds, then descend smoothly back down to a firm rest on
 *   the table before the loop repeats. The mouse runs the same
 *   cycle ~1.5 s behind the keyboard so the desk doesn't lift in
 *   lockstep.
 *
 *   Layered on top of that primary rise/fall is an organic ghostly
 *   drift on x / y / z position and pitch / yaw / roll rotation,
 *   driven by sums of three sine waves at irrationally-related
 *   frequencies (0.61 / 0.97 / 1.43 Hz). The drift is gated by an
 *   `air` factor (= base lift / peak) so it fades in as the items
 *   rise, runs at full strength while they hover, and fades out as
 *   they descend — both items lock cleanly back to their resting
 *   pose before touching down on the wood. Under
 *   `prefers-reduced-motion` both items pin firm on the table with
 *   no drift at all.
 */

export interface Peripherals {
  readonly object: THREE.Group;
  setReducedMotion(reduced: boolean): void;
  tick(deltaSeconds: number): void;
  dispose(): void;
}

export interface CreatePeripheralsArgs {
  /**
   * PC-local Y of the table surface — the height the keyboard and
   * mouse rest at when the possession loop is at one of its rest
   * phases. The tower's bottom face sits at PC-local y=0, so passing
   * 0 keeps the items flush with the tower when they touch down.
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
  // Starts firm on the table — the possession-ritual animation in
  // `tick` is what lifts it up toward the screen mid-cycle.
  keyboard.position.set(-0.1, tableY, 1.25);
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
  // Right of the keyboard, comfortable hand distance. Like the
  // keyboard, starts firm on the table — the lift is animated in
  // `tick`.
  mouse.position.set(0.85, tableY, 1.25);
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
  // current pose. The two intermediate points are lerped along the
  // straight start->end line and then nudged up a few cm so the
  // cable reads as a stiff PS/2-era cable rather than a slack line.
  //
  // The arc is added on top of the *interpolated* y rather than on
  // top of `max(start.y, end.y)` so the cable still slopes smoothly
  // when the mouse climbs ~55 cm above the tower mid-loop —
  // otherwise the midpoints would clamp to the floating mouse's
  // height and the cable would loop weirdly above it before dropping
  // back down to the tower.
  function updateCablePoints(): void {
    _scratchBack.copy(CABLE_BACK_OFFSET).applyEuler(mouse.rotation);
    cableStart.copy(mouse.position).add(_scratchBack);
    cableMidA.lerpVectors(cableStart, cableEnd, 0.35);
    cableMidA.y += 0.10;
    cableMidB.lerpVectors(cableStart, cableEnd, 0.7);
    cableMidB.y += 0.06;
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

  // ----- possession-ritual animation ---------------------------------
  // Primary lift profile: items rise from a firm rest on the table
  // up to roughly mid-screen height (the monitor body is 1.2 units
  // tall and its lower edge sits at PC-local y=0; 0.55 puts the
  // peak right around the screen's vertical centre), hover, then
  // descend back to a firm rest. One full loop takes ~18 s — long
  // enough to read as ritual rather than animation.
  const FLOAT_PEAK = 0.55;
  const FLOAT_PERIOD = 18.0;
  const MOUSE_PHASE_LAG = 1.5 / FLOAT_PERIOD;

  // Organic-drift amplitudes on top of the primary lift while the
  // items are airborne (gated by the `air` factor in `tick`). Y is
  // a Y-bob added on top of the lift, *not* the lift itself.
  const KB_DRIFT_X = 0.04;
  const KB_DRIFT_Y = 0.025;
  const KB_DRIFT_Z = 0.025;
  const KB_DRIFT_ROT_X = 0.08;
  const KB_DRIFT_ROT_Y = 0.07;
  const KB_DRIFT_ROT_Z = 0.06;

  const MS_DRIFT_X = 0.035;
  const MS_DRIFT_Y = 0.030;
  const MS_DRIFT_Z = 0.025;
  const MS_DRIFT_ROT_X = 0.07;
  const MS_DRIFT_ROT_Y = 0.10;
  const MS_DRIFT_ROT_Z = 0.08;

  function smoothstep01(x: number): number {
    if (x <= 0) return 0;
    if (x >= 1) return 1;
    return x * x * (3 - 2 * x);
  }

  // Phase profile (one full loop, [0..1]):
  //   0.00..0.10  — at firm rest on the table (lift = 0)
  //   0.10..0.40  — rise (smoothstep) toward FLOAT_PEAK
  //   0.40..0.60  — hover at peak (lift = FLOAT_PEAK)
  //   0.60..0.90  — descend (smoothstep) back to the table
  //   0.90..1.00  — at firm rest on the table
  function phaseLift(phase: number): number {
    if (phase < 0.1 || phase > 0.9) return 0;
    if (phase < 0.4) return smoothstep01((phase - 0.1) / 0.3) * FLOAT_PEAK;
    if (phase < 0.6) return FLOAT_PEAK;
    return smoothstep01((0.9 - phase) / 0.3) * FLOAT_PEAK;
  }

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
   * many minutes — so a viewer never sees the same drift twice.
   */
  function organicNoise(t: number, seed: number): number {
    return (
      Math.sin(t * 0.61 + seed * 1.7) * 0.55 +
      Math.sin(t * 0.97 + seed * 2.3) * 0.30 +
      Math.sin(t * 1.43 + seed * 0.7) * 0.15
    );
  }

  let reduced = false;

  // Pin both items firm on the table with no drift, and rebuild the
  // cable once so its arc matches the resting pose.
  function settleToRest(): void {
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
        settleToRest();
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

      // Primary lift: keyboard leads, mouse lags ~1.5 s behind.
      const kbPhase = (((t / FLOAT_PERIOD) % 1) + 1) % 1;
      const msPhase =
        (((t / FLOAT_PERIOD - MOUSE_PHASE_LAG) % 1) + 1) % 1;
      const kbLift = phaseLift(kbPhase);
      const msLift = phaseLift(msPhase);
      // `air` ∈ [0, 1] = how far up the lift envelope each item is.
      // Used to gate the organic drift so the items lock cleanly
      // back to their resting pose at the table before touching
      // down — no drift while resting, full drift at peak hover.
      const kbAir = kbLift / FLOAT_PEAK;
      const msAir = msLift / FLOAT_PEAK;

      // Keyboard: primary lift on Y, organic drift on every axis
      // (gated by air). Per-axis seeds are spaced widely so x / y /
      // z / pitch / yaw / roll all evolve on their own schedule —
      // no two axes peak together.
      keyboard.position.x =
        keyboardRestX + kbAir * KB_DRIFT_X * organicNoise(t, 2.3);
      keyboard.position.y =
        keyboardRestY + kbLift + kbAir * KB_DRIFT_Y * organicNoise(t, 1.1);
      keyboard.position.z =
        keyboardRestZ + kbAir * KB_DRIFT_Z * organicNoise(t, 3.7);
      keyboard.rotation.x =
        keyboardRestRotX + kbAir * KB_DRIFT_ROT_X * organicNoise(t, 4.5);
      keyboard.rotation.y = kbAir * KB_DRIFT_ROT_Y * organicNoise(t, 5.9);
      keyboard.rotation.z = kbAir * KB_DRIFT_ROT_Z * organicNoise(t, 7.1);

      // Mouse: same pattern, seeds shifted into a separate band
      // (11+) so the mouse and keyboard never share a wave and
      // the desk reads as two independently possessed objects.
      mouse.position.x =
        mouseRestX + msAir * MS_DRIFT_X * organicNoise(t, 11.1);
      mouse.position.y =
        mouseRestY + msLift + msAir * MS_DRIFT_Y * organicNoise(t, 12.3);
      mouse.position.z =
        mouseRestZ + msAir * MS_DRIFT_Z * organicNoise(t, 13.7);
      mouse.rotation.x = msAir * MS_DRIFT_ROT_X * organicNoise(t, 14.5);
      mouse.rotation.y =
        mouseRestRotY + msAir * MS_DRIFT_ROT_Y * organicNoise(t, 15.9);
      mouse.rotation.z = msAir * MS_DRIFT_ROT_Z * organicNoise(t, 17.1);

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
