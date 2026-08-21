import { describe, expect, it } from "vitest";
import { expandGrid, metasToHotspots } from "../src/connect/hotspots.js";
import { parseSnapMetas } from "../src/connect/shadow.js";
import { fromLdraw, IDENTITY4 } from "../src/resolve/matrix.js";

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

  // Finding 1: a grid= offset must be rotated by the meta's own ori, not
  // added to pos unrotated. Reproduces the traced real-corpus example
  // (ori=-1 0 0 0 0 -1 0 -1 0, grid=C 2 1 40 0 -- 16.8% of real grid=
  // lines carry a non-identity ori). This ori maps (x,0,0) to (-x,0,0), so
  // an uncentred grid ("2 1 40 0" -> local offsets (0,0,0) and (40,0,0),
  // not symmetric) is used instead of the finding's own centred example:
  // a centred axis's offset *set* is symmetric under this particular ori,
  // which would let a bug that forgets to rotate produce the same set by
  // coincidence and pass a same-set assertion without actually fixing
  // anything. The uncentred form has no such accidental symmetry: base +
  // offset (unrotated, the bug) and base + ori*offset (rotated, correct)
  // disagree on the second cell.
  it("rotates a grid= offset by the meta's own ori, not just the axis", () => {
    const hs = metasToHotspots([
      {
        meta: {
          type: "SNAP_CYL",
          attrs: {
            gender: "M",
            pos: "5 0 0",
            ori: "-1 0 0 0 0 -1 0 -1 0",
            grid: "2 1 40 0",
          },
        },
        xform: IDENTITY4,
      },
    ]);
    expect(hs).toHaveLength(2);
    // Cell (0,0,0) is fixed by this ori, so base+offset is unaffected either way.
    expect(hs[0]!.pos).toEqual([5, 0, 0]);
    // Cell (40,0,0) rotates to (-40,0,0) under ori, then adds base (5,0,0):
    // correct result is (-35,0,0). The pre-fix code (base+offset unrotated)
    // instead gives (45,0,0).
    expect(hs[1]!.pos).toEqual([-35, 0, 0]);
  });

  it("rotates a grid= offset by ori even when the meta placement itself also carries a world xform", () => {
    // Same ori/grid as above, but the meta reaches this part through a
    // non-identity placement xform too, confirming the two rotations
    // (meta's own ori, then the placement's xform) compose in the right
    // order rather than one accidentally cancelling or overriding the other.
    const worldXform = fromLdraw([100, 0, 0], [1, 0, 0, 0, 1, 0, 0, 0, 1]);
    const hs = metasToHotspots([
      {
        meta: {
          type: "SNAP_CYL",
          attrs: { gender: "M", pos: "5 0 0", ori: "-1 0 0 0 0 -1 0 -1 0", grid: "2 1 40 0" },
        },
        xform: worldXform,
      },
    ]);
    expect(hs[1]!.pos).toEqual([65, 0, 0]); // (-35,0,0) local, +100 world translate
  });

  // Finding 2: SNAP_FGR carries gender under genderOfs, not gender. Uses
  // the real parseSnapMetas path (not a hand-built attrs object) so the
  // attribute-name lowercasing and value casing are both exercised as they
  // really occur, per the finding's warning that the parser lowercases
  // keys but not values.
  it("reads genderOfs for SNAP_FGR, whose gender attribute is genderOfs not gender", () => {
    const metas = parseSnapMetas("0 !LDCAD SNAP_FGR [genderOfs=F] [seq=40] [radius=4] [pos=16 -52 0]");
    const placed = metas.map((meta) => ({ meta, xform: IDENTITY4 }));
    const hs = metasToHotspots(placed);
    expect(hs).toHaveLength(1);
    expect(hs[0]!.gender).toBe("female");
  });

  it("reads a male genderOfs for SNAP_FGR too", () => {
    const hs = metasToHotspots([
      { meta: { type: "SNAP_FGR", attrs: { genderofs: "M", pos: "0 30 0" } }, xform: IDENTITY4 },
    ]);
    expect(hs[0]!.gender).toBe("male");
  });

  // Finding 3 (decision b): SNAP_CLP carries no gender data in the real
  // library at all. metasToHotspots still produces a hotspot for it (so
  // its presence is detected and, via buildGraph, flaggable) but with the
  // documented "M" default -- graph.ts is responsible for making sure that
  // default can never cause a spurious pairing (see graph.test.ts).
  it("still produces a hotspot for SNAP_CLP, defaulting to male since it carries no gender data", () => {
    const hs = metasToHotspots([
      { meta: { type: "SNAP_CLP", attrs: { radius: "4", length: "11", pos: "0 -1 -10" } }, xform: IDENTITY4 },
    ]);
    expect(hs).toHaveLength(1);
    expect(hs[0]!.gender).toBe("male");
    expect(hs[0]!.kind).toBe("SNAP_CLP");
  });
});
