import type { MorphFrame } from "./morph-controller";

/**
 * The cycle the particle system steps through. Each frame names a sport,
 * picks a tint that pops on the dark canvas, and points at a generic
 * SVG silhouette the host serves from `/public`.
 *
 * Swap any `url` for your own SVG to retheme the vibe — the engine doesn't
 * care what shape it is, as long as the silhouette is opaque on a
 * transparent background.
 */
export function buildFrames(baseUrl: string): MorphFrame[] {
  const url = (name: string) => `${baseUrl.replace(/\/$/, "")}/${name}.svg`;

  return [
    {
      url: url("baseball"),
      name: "Baseball",
      caption: "Stitched leather, summer evenings",
      color: "#ffd58a",
    },
    {
      url: url("basketball"),
      name: "Basketball",
      caption: "Hardwood and squeak",
      color: "#ff7b29",
    },
    {
      url: url("football"),
      name: "Football",
      caption: "Pigskin spirals into autumn light",
      color: "#d4a36d",
    },
    {
      url: url("soccer-ball"),
      name: "Soccer",
      caption: "The world's game, in 32 panels",
      color: "#e8efff",
    },
  ];
}
