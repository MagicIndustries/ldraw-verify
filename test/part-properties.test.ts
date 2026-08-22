import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

interface PartProperties {
  desc: string;
  category: string;
  topStuds: number;
  bores: number[];
  throughBore: boolean;
}
const table = JSON.parse(readFileSync("data/part-properties.json", "utf8")) as {
  parts: Record<string, PartProperties>;
  notDerivable: Record<string, string>;
};
const p = (id: string): PartProperties => {
  const r = table.parts[id];
  if (!r) throw new Error(`${id} missing from data/part-properties.json`);
  return r;
};

describe("part-property table", () => {
  it("separates tiles from plates by their studs", () => {
    expect(p("3070b.dat").topStuds).toBe(0); // Tile 1x1
    expect(p("3068b.dat").topStuds).toBe(0); // Tile 2x2
    expect(p("3024.dat").topStuds).toBe(1); // Plate 1x1
    expect(p("3022.dat").topStuds).toBe(4); // Plate 2x2
    expect(p("3001.dat").topStuds).toBe(8); // Brick 2x4
  });

  // The reason this table derives tile-versus-plate from connectivity and not
  // from the description. 30 parts disagree with their own names, and in every
  // case the connectivity is right: an inverted tile really does present studs,
  // and a "Plate 1x1 Round with Swirled Top" really has none. Name-matching
  // would be wrong in both directions.
  it("trusts connectivity over the part name where they disagree", () => {
    expect(p("11203.dat").desc).toMatch(/^Tile/); // Tile 2x2 Inverted
    expect(p("11203.dat").topStuds).toBeGreaterThan(0);
    expect(p("15470.dat").desc).toMatch(/^Plate/); // Plate 1x1 Round with Swirled Top
    expect(p("15470.dat").topStuds).toBe(0);
  });

  it("records bore sizes and marks genuine through-holes", () => {
    const beam = p("3700.dat"); // Technic Brick 1x2 with Hole
    expect(beam.bores).toContain(6);
    expect(beam.throughBore).toBe(true);
    expect(p("3024.dat").throughBore).toBe(false); // a plate's anti-stud is blind
  });

  // B-01's false-positive class, visible as data: a hollow stud reports an
  // open bore exactly as a Technic hole does, which is why caps= alone never
  // identified a pinhole. See docs/rules-testing/B-01-CORPUS-SCAN.md.
  it("shows why an open bore does not imply a Technic hole", () => {
    expect(p("3062b.dat").desc).toMatch(/Hollow Stud/);
    expect(p("3062b.dat").throughBore).toBe(true);
  });

  it("names what it cannot derive rather than leaving the gap silent", () => {
    expect(Object.keys(table.notDerivable).sort()).toEqual(["material", "slopeAngle", "travelStop"]);
  });
});
