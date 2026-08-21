import { describe, expect, it } from "vitest";
import { expandGrid, metasToHotspots } from "../src/connect/hotspots.js";
import { IDENTITY4 } from "../src/resolve/matrix.js";

// expandGrid's full two-axis / centred-axis / degraded-form semantics are
// already covered by grid.test.ts against src/connect/grid.ts, which is
// where the real implementation lives (Task 9). hotspots.ts re-exports it
// rather than defining a second copy -- these are a thin sanity check that
// the re-export is wired up, using the real shadow-library grid= syntax
// (space-separated "C <n>", confirmed against the real shadow library's
// SNAP_CYL grid= values) rather than an invented no-space "C2" form.
describe("expandGrid (re-exported from grid.ts)", () => {
  it("expands a 2x4 grid at 20 LDU spacing into 8 offsets", () => {
    expect(expandGrid({ grid: "2 4 20 20" })).toHaveLength(8);
  });

  it("returns a single origin offset when there is no grid attribute", () => {
    expect(expandGrid({})).toEqual([[0, 0, 0]]);
  });
});

describe("metasToHotspots", () => {
  it("reads gender, position and axis from a SNAP_CYL meta", () => {
    const hs = metasToHotspots([
      { meta: { type: "SNAP_CYL", attrs: { gender: "M", pos: "0 -4 0", secs: "R 6 4" } }, xform: IDENTITY4 },
    ]);
    expect(hs).toHaveLength(1);
    expect(hs[0]!.gender).toBe("male");
    expect(hs[0]!.pos).toEqual([0, -4, 0]);
    expect(hs[0]!.axis).toEqual([0, -1, 0]);
  });

  it("expands a gridded meta into one hotspot per grid cell", () => {
    const hs = metasToHotspots([
      { meta: { type: "SNAP_CYL", attrs: { gender: "M", pos: "0 -4 0", grid: "2 4 20 20" } }, xform: IDENTITY4 },
    ]);
    expect(hs).toHaveLength(8);
  });

  it("skips SNAP_INCL and SNAP_CLEAR, which are not themselves connections", () => {
    expect(metasToHotspots([{ meta: { type: "SNAP_INCL", attrs: {} }, xform: IDENTITY4 }])).toHaveLength(0);
    expect(metasToHotspots([{ meta: { type: "SNAP_CLEAR", attrs: {} }, xform: IDENTITY4 }])).toHaveLength(0);
  });

  it("reads a female gender and a radius from secs", () => {
    const hs = metasToHotspots([
      { meta: { type: "SNAP_CYL", attrs: { gender: "F", pos: "0 0 0", secs: "R 6 20" } }, xform: IDENTITY4 },
    ]);
    expect(hs[0]!.gender).toBe("female");
    expect(hs[0]!.radius).toBe(6);
  });

  it("omits radius entirely (not radius: undefined) when secs is absent", () => {
    const hs = metasToHotspots([
      { meta: { type: "SNAP_CYL", attrs: { gender: "M", pos: "0 0 0" } }, xform: IDENTITY4 },
    ]);
    expect("radius" in hs[0]!).toBe(false);
  });
});
