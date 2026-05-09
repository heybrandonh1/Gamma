import * as THREE from "three";

/**
 * Wide circular wood table with a ring of carved runes glowing around
 * the rim.
 *
 * The rune ring is baked once into a 1024×1024 canvas and used as both
 * `emissiveMap` and `alphaMap` of a separate disc that sits 1 mm above
 * the table top. The disc material's `emissiveIntensity` is animated
 * with a slow heartbeat (`0.4 + 0.2 * sin(t * 0.6)`); under
 * `reduceMotion` it pins at the median (0.4) so the colour is steady.
 *
 * Runes are procedurally drawn (no font dependency) — short straight
 * line glyphs arranged at twelve evenly-spaced positions around a
 * ring. Deterministic, so the same pattern shows up across mounts.
 */

export interface WizardTable {
  readonly object: THREE.Group;
  /** Top Y of the table in world space — useful for placing things on top. */
  readonly topY: number;
  /** Outer radius of the table top, for placing edge decorations. */
  readonly radius: number;
  setReducedMotion(reduced: boolean): void;
  tick(deltaSeconds: number): void;
  dispose(): void;
}

const TABLE_RADIUS = 4.2;
const TABLE_HEIGHT = 0.18;

/** Generate a 1024×1024 procedural rune ring as an emissive texture. */
function buildRuneTexture(): THREE.CanvasTexture {
  const size = 1024;
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("wizard-table: 2D context unavailable");

  ctx.fillStyle = "#000000";
  ctx.fillRect(0, 0, size, size);

  const cx = size / 2;
  const cy = size / 2;
  const ringRadius = size * 0.43;
  const glyphSize = size * 0.025;

  ctx.strokeStyle = "#ffd17a";
  ctx.lineWidth = 6;
  ctx.lineCap = "round";

  // Draw two concentric thin circles bracketing the rune ring.
  ctx.beginPath();
  ctx.arc(cx, cy, ringRadius + glyphSize * 1.6, 0, Math.PI * 2);
  ctx.stroke();
  ctx.beginPath();
  ctx.arc(cx, cy, ringRadius - glyphSize * 1.6, 0, Math.PI * 2);
  ctx.stroke();

  // Twelve rune positions around the ring. Each rune is built from
  // short straight strokes — a mix of vertical, diagonal, branching
  // shapes — with a deterministic seed per index.
  const runeCount = 24;
  for (let i = 0; i < runeCount; i++) {
    const a = (i / runeCount) * Math.PI * 2;
    const x = cx + Math.cos(a) * ringRadius;
    const y = cy + Math.sin(a) * ringRadius;
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(a + Math.PI / 2);
    drawRune(ctx, glyphSize, i);
    ctx.restore();
  }

  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  tex.needsUpdate = true;
  return tex;
}

/** Deterministic rune glyph — a small bag of straight strokes. */
function drawRune(
  ctx: CanvasRenderingContext2D,
  s: number,
  seed: number,
): void {
  const variants: Array<Array<[number, number, number, number]>> = [
    // vertical bar with two ticks
    [
      [0, -s, 0, s],
      [-s * 0.5, -s * 0.4, 0, -s * 0.1],
      [s * 0.5, s * 0.1, 0, s * 0.4],
    ],
    // X
    [
      [-s * 0.7, -s, s * 0.7, s],
      [s * 0.7, -s, -s * 0.7, s],
    ],
    // F-ish
    [
      [-s * 0.4, -s, -s * 0.4, s],
      [-s * 0.4, -s, s * 0.4, -s],
      [-s * 0.4, 0, s * 0.2, 0],
    ],
    // angle
    [
      [-s * 0.6, -s, s * 0.6, 0],
      [s * 0.6, 0, -s * 0.6, s],
    ],
    // tridr
    [
      [0, -s, 0, s],
      [-s * 0.6, -s * 0.6, 0, 0],
      [s * 0.6, -s * 0.6, 0, 0],
    ],
    // thurisaz
    [
      [-s * 0.4, -s, -s * 0.4, s],
      [-s * 0.4, -s * 0.7, s * 0.5, -s * 0.2],
      [-s * 0.4, s * 0.7, s * 0.5, s * 0.2],
    ],
  ];
  const pick = variants[seed % variants.length];
  ctx.beginPath();
  for (const [x0, y0, x1, y1] of pick) {
    ctx.moveTo(x0, y0);
    ctx.lineTo(x1, y1);
  }
  ctx.stroke();
}

/** Procedural wood-grain canvas — tonal stripes plus a few knots. */
function buildWoodTexture(): THREE.CanvasTexture {
  const size = 512;
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("wizard-table: 2D context unavailable");

  // Base wood tone.
  ctx.fillStyle = "#3b2615";
  ctx.fillRect(0, 0, size, size);

  // Concentric ring grain — quick and convincing for a top-down view.
  for (let r = 0; r < size; r += 6) {
    const v = Math.sin(r * 0.06) * 12 + 60;
    ctx.strokeStyle = `rgba(${80 + v}, ${40 + v * 0.4}, 20, 0.22)`;
    ctx.lineWidth = 1 + Math.random() * 2;
    ctx.beginPath();
    ctx.arc(size / 2, size / 2, r, 0, Math.PI * 2);
    ctx.stroke();
  }

  // Knots.
  for (let i = 0; i < 6; i++) {
    const x = Math.random() * size;
    const y = Math.random() * size;
    const knot = ctx.createRadialGradient(x, y, 0, x, y, 30 + Math.random() * 40);
    knot.addColorStop(0, "rgba(20, 10, 4, 0.7)");
    knot.addColorStop(1, "rgba(20, 10, 4, 0)");
    ctx.fillStyle = knot;
    ctx.fillRect(x - 60, y - 60, 120, 120);
  }

  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.anisotropy = 4;
  tex.needsUpdate = true;
  return tex;
}

export function createWizardTable(): WizardTable {
  const group = new THREE.Group();
  group.name = "wizard-table";

  const woodTex = buildWoodTexture();
  const runeTex = buildRuneTexture();

  // Table top — a low cylinder with the wood texture mapped to the cap.
  const topGeo = new THREE.CylinderGeometry(
    TABLE_RADIUS,
    TABLE_RADIUS,
    TABLE_HEIGHT,
    64,
    1,
  );
  const topMat = new THREE.MeshStandardMaterial({
    color: new THREE.Color("#5c3a1f"),
    map: woodTex,
    roughness: 0.85,
    metalness: 0.0,
  });
  const top = new THREE.Mesh(topGeo, topMat);
  top.position.y = -TABLE_HEIGHT / 2;
  group.add(top);

  // Pedestal: a heavy column under the centre, just enough to sit
  // below the visible card crop. It also helps with shadow occlusion
  // if the host ever turns shadows on.
  const pedGeo = new THREE.CylinderGeometry(0.9, 1.4, 1.2, 24);
  const pedMat = new THREE.MeshStandardMaterial({
    color: new THREE.Color("#2a1a0c"),
    roughness: 0.95,
  });
  const ped = new THREE.Mesh(pedGeo, pedMat);
  ped.position.y = -TABLE_HEIGHT - 0.6;
  group.add(ped);

  // Rune disc — sits 1 mm above the table top, lit by emissive only so
  // it punches through the dark scene without depending on the
  // ambient setup.
  const runeGeo = new THREE.CircleGeometry(TABLE_RADIUS - 0.02, 96);
  runeGeo.rotateX(-Math.PI / 2);
  const runeMat = new THREE.MeshStandardMaterial({
    color: new THREE.Color("#000000"),
    emissive: new THREE.Color("#ffb060"),
    emissiveMap: runeTex,
    emissiveIntensity: 0.6,
    transparent: true,
    alphaMap: runeTex,
    depthWrite: false,
    roughness: 1,
  });
  const runeDisc = new THREE.Mesh(runeGeo, runeMat);
  runeDisc.position.y = 0.001;
  group.add(runeDisc);

  let reduced = false;
  const t0 = performance.now() / 1000;

  return {
    object: group,
    topY: 0,
    radius: TABLE_RADIUS,
    setReducedMotion(v: boolean) {
      reduced = v;
      if (reduced) runeMat.emissiveIntensity = 0.4;
    },
    tick(_delta: number) {
      if (reduced) return;
      const t = performance.now() / 1000 - t0;
      runeMat.emissiveIntensity = 0.45 + 0.25 * Math.sin(t * 0.7);
    },
    dispose() {
      topGeo.dispose();
      topMat.dispose();
      pedGeo.dispose();
      pedMat.dispose();
      runeGeo.dispose();
      runeMat.dispose();
      woodTex.dispose();
      runeTex.dispose();
    },
  };
}
