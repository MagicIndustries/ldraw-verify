import { describe, expect, it } from "vitest";
import {
  expandGrid,
  freeRotationAxes,
  metasToHotspots,
  rotationallySymmetricAxis,
} from "../src/connect/hotspots.js";
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

// ---------------------------------------------------------------------
// B-05 scope derivation. These two functions are the whole of the
// "which parts is a yaw claim meaningful for" question -- see
// `noFractionalRotation` in src/rules/l5-legality.ts. Metas are written
// here in the real shadow library's own syntax, quoting real parts, so
// each case says which physical part it stands for.
// ---------------------------------------------------------------------

const meta = (type: string, attrs: Record<string, string>) => ({ meta: { type, attrs }, xform: IDENTITY4 });

describe("rotationallySymmetricAxis", () => {
  // 6141.dat, "Plate 1 x 1 Round": one centred round anti-stud, one
  // centred round stud. Turning it about Y moves nothing.
  it("finds the axis of a round 1x1 plate whose connectors are all round, coaxial and centred", () => {
    const hs = metasToHotspots([
      meta("SNAP_CYL", { gender: "F", caps: "one", secs: "R 6 5", pos: "0 8 0" }),
      meta("SNAP_CYL", { gender: "M", caps: "one", secs: "R 6 4", pos: "0 0 0" }),
    ]);
    expect(rotationallySymmetricAxis(hs)).toEqual([0, -1, 0]);
  });

  // THE guard that keeps this exemption from swallowing B-05 itself.
  // 3024.dat, "Plate 1 x 1", has its connectors in exactly the same two
  // places as 6141.dat above and is distinguished only by the `S` section
  // of its anti-stud cavity. A square plate turned 45 degrees is precisely
  // the violation the rule exists to catch.
  it("rejects a square 1x1 plate, whose connectors sit in the same places but whose anti-stud is S-section", () => {
    const hs = metasToHotspots([
      meta("SNAP_CYL", { gender: "F", caps: "one", secs: "S 6 4", pos: "0 8 0" }),
      meta("SNAP_CYL", { gender: "M", caps: "one", secs: "R 6 4", pos: "0 0 0" }),
    ]);
    expect(rotationallySymmetricAxis(hs)).toBeUndefined();
  });

  // 2819.dat, "Technic Steering Wheel Small": round outside, but its
  // mount is an axle hole, and an axle cross seats in four orientations.
  it("rejects a part whose coaxial connector is an axle cross, which has its own 90-degree detent", () => {
    const hs = metasToHotspots([
      meta("SNAP_CYL", { gender: "F", caps: "none", secs: "A 6 14", pos: "0 24 0" }),
      meta("SNAP_CYL", { gender: "M", caps: "one", secs: "R 6 4", pos: "0 0 0" }),
    ]);
    expect(rotationallySymmetricAxis(hs)).toBeUndefined();
  });

  // 30383.dat's two anti-studs sit +-10 LDU either side of centre: round
  // sections would not save it, because turning the part moves them.
  it("rejects a part with a round connector that is off the shared axis", () => {
    const hs = metasToHotspots([
      meta("SNAP_CYL", { gender: "F", caps: "one", secs: "R 6 4", pos: "-10 8 0" }),
      meta("SNAP_CYL", { gender: "M", caps: "one", secs: "R 6 4", pos: "0 0 0" }),
    ]);
    expect(rotationallySymmetricAxis(hs)).toBeUndefined();
  });

  it("rejects a part whose connectors are centred but point along different axes", () => {
    const hs = metasToHotspots([
      meta("SNAP_CYL", { gender: "F", caps: "one", secs: "R 6 4", pos: "0 0 0", ori: "1 0 0 0 0 -1 0 1 0" }),
      meta("SNAP_CYL", { gender: "M", caps: "one", secs: "R 6 4", pos: "0 0 0" }),
    ]);
    expect(rotationallySymmetricAxis(hs)).toBeUndefined();
  });

  // The line need not run through the part's own origin -- see the
  // function's doc comment for why an offset line is no weaker a claim.
  it("accepts a coaxial round part whose axis is offset from the part origin", () => {
    const hs = metasToHotspots([
      meta("SNAP_CYL", { gender: "F", caps: "one", secs: "R 6 4", pos: "20 8 0" }),
      meta("SNAP_CYL", { gender: "M", caps: "one", secs: "R 6 4", pos: "20 0 0" }),
    ]);
    expect(rotationallySymmetricAxis(hs)).toEqual([0, -1, 0]);
  });

  it("claims nothing about a part with no connectors at all", () => {
    expect(rotationallySymmetricAxis([])).toBeUndefined();
  });
});

describe("freeRotationAxes", () => {
  // 2433.dat, "Hinge Bar 2 with 3 Fingers and Top Stud".
  it("reports a hinge finger's axis", () => {
    const hs = metasToHotspots([meta("SNAP_FGR", { genderofs: "M", pos: "0 36 0", ori: "1 0 0 0 0 1 0 -1 0" })]);
    expect(freeRotationAxes(hs)).toHaveLength(1);
  });

  it("reports a ball joint's axis", () => {
    expect(freeRotationAxes(metasToHotspots([meta("SNAP_SPH", { gender: "M", pos: "0 0 0" })]))).toHaveLength(1);
  });

  // A bar in a clip, or a round shaft in a round hole: [slide=true] with a
  // round profile. Free along the axis and free about it.
  it("reports a round sliding shaft's axis", () => {
    const hs = metasToHotspots([meta("SNAP_CYL", { gender: "M", caps: "one", secs: "R 4 14", slide: "true" })]);
    expect(freeRotationAxes(hs)).toEqual([[0, -1, 0]]);
  });

  // 6587.dat, "Technic Axle 3 with Stud": slides freely, rotates in
  // exactly four positions. `slide=true` alone would wrongly free it.
  it("does not report a sliding AXLE, which seats in only four orientations", () => {
    const hs = metasToHotspots([meta("SNAP_CYL", { gender: "M", caps: "none", secs: "A 6 58", slide: "true" })]);
    expect(freeRotationAxes(hs)).toEqual([]);
  });

  it("does not report an ordinary, non-sliding stud", () => {
    const hs = metasToHotspots([meta("SNAP_CYL", { gender: "M", caps: "one", secs: "R 6 4" })]);
    expect(freeRotationAxes(hs)).toEqual([]);
  });
});
