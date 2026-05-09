/**
 * Rasterize an SVG into an offscreen canvas, then sample N points uniformly
 * from the opaque pixels. The resulting points (in normalized [-1, 1] space)
 * are the target positions particles morph into.
 *
 * We deliberately don't use three.js's `SVGLoader` here — it parses paths
 * into `THREE.Shape` instances which then need triangulation + area-weighted
 * sampling to fill uniformly. Rasterizing to a 2D canvas and reading the
 * alpha channel does the same thing in a few lines and works for ANY SVG
 * (including ones with `fill-rule="evenodd"` cutouts, which our seam patterns
 * rely on).
 */

export interface Sample {
  x: number;
  y: number;
}

const RASTER_RESOLUTION = 256;

function loadImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => resolve(img);
    img.onerror = (e) => reject(new Error(`failed to load svg: ${url} (${e})`));
    img.src = url;
  });
}

/**
 * Rasterize the SVG at `url` and return `count` random points inside the
 * opaque region, normalized to [-1, 1] with y pointing up (three.js
 * convention). Aspect ratio is preserved by fitting the SVG to a square
 * sample box and centering it.
 */
export async function sampleSvg(
  url: string,
  count: number,
): Promise<Sample[]> {
  const img = await loadImage(url);

  const cv =
    typeof OffscreenCanvas !== "undefined"
      ? (new OffscreenCanvas(
          RASTER_RESOLUTION,
          RASTER_RESOLUTION,
        ) as unknown as HTMLCanvasElement)
      : (() => {
          const c = document.createElement("canvas");
          c.width = RASTER_RESOLUTION;
          c.height = RASTER_RESOLUTION;
          return c;
        })();

  const ctx = cv.getContext("2d") as
    | CanvasRenderingContext2D
    | OffscreenCanvasRenderingContext2D
    | null;
  if (!ctx) throw new Error("logo-forge: 2d context unavailable");

  // Letterbox the SVG into the square raster so we don't squish wide marks.
  const aspect = img.width / img.height || 1;
  let dw = RASTER_RESOLUTION;
  let dh = RASTER_RESOLUTION;
  if (aspect > 1) dh = RASTER_RESOLUTION / aspect;
  else dw = RASTER_RESOLUTION * aspect;
  const dx = (RASTER_RESOLUTION - dw) / 2;
  const dy = (RASTER_RESOLUTION - dh) / 2;

  ctx.clearRect(0, 0, RASTER_RESOLUTION, RASTER_RESOLUTION);
  ctx.drawImage(img, dx, dy, dw, dh);

  const { data } = ctx.getImageData(0, 0, RASTER_RESOLUTION, RASTER_RESOLUTION);

  // Build a flat list of opaque pixel indices once, then do uniform sampling
  // from it. This is O(W*H) per logo but only runs at preload — and 256² is
  // 65k pixels, well under a frame budget.
  const opaque: number[] = [];
  for (let i = 0; i < data.length; i += 4) {
    if (data[i + 3] > 128) opaque.push(i / 4);
  }

  if (opaque.length === 0) {
    throw new Error(`logo-forge: svg ${url} has no opaque pixels`);
  }

  const samples: Sample[] = new Array(count);
  for (let i = 0; i < count; i++) {
    const idx = opaque[(Math.random() * opaque.length) | 0];
    const px = idx % RASTER_RESOLUTION;
    const py = (idx / RASTER_RESOLUTION) | 0;
    // Normalize to [-1, 1], flip y so +y is up (three.js).
    samples[i] = {
      x: (px / RASTER_RESOLUTION) * 2 - 1,
      y: -((py / RASTER_RESOLUTION) * 2 - 1),
    };
  }

  return samples;
}
