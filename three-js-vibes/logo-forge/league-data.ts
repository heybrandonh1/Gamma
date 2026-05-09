import type { MorphFrame } from "./morph-controller";

/**
 * The cycle the particle system steps through. Each frame names a piece of
 * sporting equipment, picks a tint that pops on the dark canvas, and points
 * at a generic SVG silhouette the host serves from `/public`.
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
      caption: "Cowhide, red stitches, summer evenings",
      color: "#ffd58a",
    },
    {
      url: url("bat"),
      name: "Bat",
      caption: "Northern white ash, lathe-turned",
      color: "#e6c089",
    },
    {
      url: url("basketball"),
      name: "Basketball",
      caption: "Pebbled grain, eight-panel seam",
      color: "#ff7b29",
    },
    {
      url: url("football"),
      name: "Football",
      caption: "Pigskin laces, autumn light",
      color: "#d4a36d",
    },
    {
      url: url("soccer-ball"),
      name: "Soccer Ball",
      caption: "Twelve pentagons, twenty hexagons",
      color: "#e8efff",
    },
    {
      url: url("hockey-puck"),
      name: "Hockey Puck",
      caption: "Vulcanized rubber, frozen smooth",
      color: "#9fb4cc",
    },
  ];
}
