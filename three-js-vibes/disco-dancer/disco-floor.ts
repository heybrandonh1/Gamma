import * as THREE from "three";

/**
 * Disco floor: a TILES_PER_SIDE × TILES_PER_SIDE grid of square panels.
 *
 * About half the tiles are "lit" — they own a colored emissive material that
 * cycles through the party palette out of phase with their neighbors. The
 * rest are "dark" — neutral charcoal panels that just sit there. The mix
 * gives the floor a lived-in, pixel-art-y feel rather than the busy
 * everything-glows look of the previous version.
 *
 * Lit/dark assignment is deterministic via a small integer hash, so the
 * pattern is identical across mounts and reduce-motion swaps.
 */

const TILES_PER_SIDE = 16;
const TILE_SIZE = 80;

/**
 * Strong ultraviolet palette: deep violets, electric purples, and hot
 * magentas with a single near-UV indigo to anchor the cool end. Reads
 * like a blacklight dancefloor rather than the previous rainbow club.
 */
const PALETTE: number[] = [
  0x4400dd, // near-UV indigo
  0x6f00ff, // deep violet
  0x9d00ff, // electric purple
  0xb026ff, // neon purple
  0xd900ff, // electric magenta
  0xff33cc, // UV pink
];

// Pushed up from the previous "club" cap so the UV tiles glow hard
// enough to read as actual blacklight rather than tinted concrete.
const MAX_EMISSIVE = 1.1;

/** Roughly this fraction of tiles are colored/animated; rest stay dark. */
const LIT_FRACTION = 0.55;

/**
 * Cheap integer hash → [0,1). Stable across runs so the pattern of lit vs
 * dark tiles is identical every mount, which avoids visible "reshuffle"
 * flashes when reduce-motion toggles or the canvas remounts.
 */
function tileHash(x: number, z: number): number {
  let h = (x * 374761393 + z * 668265263) | 0;
  h = (h ^ (h >>> 13)) | 0;
  h = Math.imul(h, 1274126177) | 0;
  h = (h ^ (h >>> 16)) >>> 0;
  return h / 0xffffffff;
}

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
      const lit = tileHash(x, z) < LIT_FRACTION;

      let mat: THREE.MeshStandardMaterial;
      if (lit) {
        const startIdx = (x * 7 + z * 13) % PALETTE.length;
        mat = new THREE.MeshStandardMaterial({
          color: 0x0a0014,
          emissive: PALETTE[startIdx],
          emissiveIntensity: MAX_EMISSIVE * 0.6,
          metalness: 0.2,
          roughness: 0.5,
        });
      } else {
        // Dark tile — a faint violet-tinted black so the negative space
        // between lit panels still reads as "blacklight floor" rather
        // than neutral concrete. Receives shadows from the dancers/ball.
        mat = new THREE.MeshStandardMaterial({
          color: 0x0c0418,
          emissive: 0x000000,
          emissiveIntensity: 0,
          metalness: 0.15,
          roughness: 0.85,
        });
      }

      const mesh = new THREE.Mesh(tileGeo, mat);
      mesh.rotation.x = -Math.PI / 2;
      mesh.position.set(
        x * TILE_SIZE - half + TILE_SIZE / 2,
        0,
        z * TILE_SIZE - half + TILE_SIZE / 2,
      );
      mesh.receiveShadow = true;
      group.add(mesh);

      // Only push lit tiles into the animation list — dark ones don't need
      // per-frame updates.
      if (lit) {
        const startIdx = (x * 7 + z * 13) % PALETTE.length;
        const nextIdx = (startIdx + 1 + ((x + z) % (PALETTE.length - 1))) % PALETTE.length;
        tiles.push({
          mesh,
          phase: Math.random() * Math.PI * 2,
          period: 3.5 + Math.random() * 3.5,
          fromIdx: startIdx,
          toIdx: nextIdx,
        });
      }
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
    // Dispose every tile's material — both lit ones (in `tiles`) and the
    // dark ones (only reachable via the group children).
    for (const child of group.children) {
      const mesh = child as THREE.Mesh<THREE.PlaneGeometry, THREE.MeshStandardMaterial>;
      if (mesh.isMesh && mesh.material) mesh.material.dispose();
    }
    tileGeo.dispose();
  }

  return { group, update, dispose };
}
