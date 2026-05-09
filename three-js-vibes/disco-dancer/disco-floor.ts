import * as THREE from "three";

/**
 * Disco floor: a TILES_PER_SIDE × TILES_PER_SIDE grid of square panels. Each
 * tile owns its own MeshStandardMaterial so we can lerp its emissive color
 * independently for the shimmer effect.
 *
 * Tuned to read as a vibrant club floor against the new light card bg —
 * saturated party hues with a moderately strong emissive cap, but per-tile
 * phase randomization keeps it from strobing.
 */

const TILES_PER_SIDE = 16;
const TILE_SIZE = 80;

/**
 * Six saturated party hues. Match the club-light and confetti palettes so
 * the whole scene reads as one coherent set of colors rather than three
 * unrelated rainbows.
 */
const PALETTE: number[] = [
  0xff3366, // hot pink
  0xff9933, // tangerine
  0xffd633, // sunshine yellow
  0x33ff99, // electric mint
  0x33ccff, // cyan
  0x9933ff, // purple
];

const MAX_EMISSIVE = 0.5;

interface TileData {
  mesh: THREE.Mesh<THREE.PlaneGeometry, THREE.MeshStandardMaterial>;
  /** Random phase offset (radians) so tiles cycle out of sync. */
  phase: number;
  /** Per-tile cycle period in seconds (~3.5 to ~7s). */
  period: number;
  /** Color index that this tile is currently animating away from. */
  fromIdx: number;
  /** Color index that this tile is currently animating toward. */
  toIdx: number;
}

const tmpFrom = new THREE.Color();
const tmpTo = new THREE.Color();

export function buildDiscoFloor(): {
  group: THREE.Group;
  /** Call from your render loop with `clock.getElapsedTime()`. Cheap (~256 lerps/frame). */
  update: (elapsedSeconds: number, paused?: boolean) => void;
  dispose: () => void;
} {
  const group = new THREE.Group();
  group.name = "disco-dancer-floor";

  // One shared geometry; per-tile materials so we can vary emissive.
  const tileGeo = new THREE.PlaneGeometry(TILE_SIZE, TILE_SIZE);

  const tiles: TileData[] = [];

  const half = (TILES_PER_SIDE * TILE_SIZE) / 2;

  for (let x = 0; x < TILES_PER_SIDE; x++) {
    for (let z = 0; z < TILES_PER_SIDE; z++) {
      const startIdx = (x * 7 + z * 13) % PALETTE.length;
      const nextIdx = (startIdx + 1 + ((x + z) % (PALETTE.length - 1))) % PALETTE.length;

      const mat = new THREE.MeshStandardMaterial({
        color: 0x18181b,
        emissive: PALETTE[startIdx],
        emissiveIntensity: MAX_EMISSIVE * 0.6,
        metalness: 0.2,
        roughness: 0.5,
      });

      const mesh = new THREE.Mesh(tileGeo, mat);
      mesh.rotation.x = -Math.PI / 2;
      mesh.position.set(
        x * TILE_SIZE - half + TILE_SIZE / 2,
        0,
        z * TILE_SIZE - half + TILE_SIZE / 2,
      );
      mesh.receiveShadow = true;
      group.add(mesh);

      tiles.push({
        mesh,
        phase: Math.random() * Math.PI * 2,
        period: 3.5 + Math.random() * 3.5,
        fromIdx: startIdx,
        toIdx: nextIdx,
      });
    }
  }

  function update(elapsed: number, paused = false) {
    if (paused) return;

    for (const tile of tiles) {
      // Normalized cycle position in [0,1).
      const cycle = ((elapsed / tile.period) + tile.phase / (Math.PI * 2)) % 1;
      // Half-sine ease for the lerp factor — smooth in/out rather than linear.
      const t = 0.5 - 0.5 * Math.cos(cycle * Math.PI * 2);

      // When we wrap around the cycle, advance to/from indices so the next
      // segment lerps from the current target to a new pastel.
      const lastSlot = (tile as TileData & { lastSlot?: number }).lastSlot;
      const slot = Math.floor(cycle * 2); // 0 = forward leg, 1 = backward leg
      if (lastSlot !== slot) {
        if (slot === 0) {
          tile.fromIdx = tile.toIdx;
          tile.toIdx = (tile.toIdx + 1 + Math.floor(Math.random() * (PALETTE.length - 1))) % PALETTE.length;
        }
        (tile as TileData & { lastSlot?: number }).lastSlot = slot;
      }

      tmpFrom.setHex(PALETTE[tile.fromIdx]);
      tmpTo.setHex(PALETTE[tile.toIdx]);
      tile.mesh.material.emissive.copy(tmpFrom).lerp(tmpTo, t);

      // Intensity also breathes a touch (cap stays at MAX_EMISSIVE).
      tile.mesh.material.emissiveIntensity = MAX_EMISSIVE * (0.55 + 0.45 * t);
    }
  }

  function dispose() {
    for (const tile of tiles) tile.mesh.material.dispose();
    tileGeo.dispose();
  }

  return { group, update, dispose };
}
