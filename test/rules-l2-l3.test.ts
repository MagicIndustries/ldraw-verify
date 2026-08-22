import { describe, expect, it } from "vitest";
import { LibraryIndex } from "../src/library/index.js";
import { parseDocument } from "../src/parse/document.js";
import { resolveModel } from "../src/resolve/resolve.js";
import { l2Rules } from "../src/rules/l2-matrix.js";
import { l3Rules } from "../src/rules/l3-grid.js";
import type { StudFootprint } from "../src/connect/graph.js";
import type { Rule, RuleMeta } from "../src/rules/types.js";

const lib = await LibraryIndex.fromDirectory("test/fixtures/lib");
const meta = (id: string, tier: RuleMeta["tier"] = "HARD"): RuleMeta => ({ id, name: id, tier, statement: "" });

function fire(rule: Rule, text: string, tier: RuleMeta["tier"] = "HARD") {
  const model = resolveModel(parseDocument(text, "t.ldr"), lib);
  return rule.run({ model, library: lib, meta: meta(rule.id, tier) });
}

const byId = (rules: Rule[], id: string) => rules.find((r) => r.id === id)!;

describe("L2/L3 rules", () => {
  it("E-01 passes an identity placement", () => {
    expect(fire(byId(l2Rules, "E-01"), "1 4 0 -24 0 1 0 0 0 1 0 0 0 1 3001.dat")).toHaveLength(0);
  });

  it("E-01 fails a sheared matrix", () => {
    const f = fire(byId(l2Rules, "E-01"), "1 4 0 0 0 1 0.5 0 0 1 0 0 0 1 3001.dat");
    expect(f[0]!.status).toBe("fail");
    expect(f[0]!.message).toContain("orthonormal");
  });

  it("E-01 fails a singular matrix", () => {
    const f = fire(byId(l2Rules, "E-01"), "1 4 0 0 0 0 0 0 0 1 0 0 0 1 3001.dat");
    expect(f[0]!.status).toBe("fail");
  });

  it("E-01 reports a mirrored placement without failing it", () => {
    const f = fire(byId(l2Rules, "E-01"), "1 4 0 0 0 -1 0 0 0 1 0 0 0 1 3001.dat");
    expect(f.every((x) => x.status !== "fail")).toBe(true);
  });

  // TASK 14, Finding 1: this pins CORRECT behaviour, not a missed detection.
  // ROT_Y90 transposed is R_y(-90 deg) -- a genuine, different-but-valid
  // rotation, not a symmetric matrix that happens to equal its own
  // transpose. For any genuine rotation R, transpose(R) == inverse(R),
  // which is itself orthonormal with determinant +1: a transposed rotation
  // is a perfectly well-formed rotation, just the wrong one. No
  // orthonormality or determinant test -- at any tolerance -- can tell
  // forward from transposed, so E-01 must NOT flag this. A future
  // maintainer must not "fix" this by tightening ORTHONORMALITY_EPS or
  // otherwise trying to make E-01 catch it: it is undetectable from a
  // single file, because doing so requires knowing the intended geometry.
  // See E-01's note in rules/lego-build-rules.yaml and its `not_checkable`
  // entry.
  it("E-01 does not flag a transposed-but-valid rotation (transposition is undetectable by this predicate, by design)", () => {
    // transpose of ROT_Y90 = [0,0,1, 0,1,0, -1,0,0] is [0,0,-1, 0,1,0, 1,0,0]
    const transposedY90 = "1 4 0 0 0 0 0 -1 0 1 0 1 0 0 3001.dat";
    expect(fire(byId(l2Rules, "E-01"), transposedY90)).toHaveLength(0);
  });

  // VERIFICATION PASS: this used to assert E-02 fails ANY positive Y. That
  // clause was removed (src/rules/l3-grid.ts's SYSTEM_LDU_QUANTUM doc
  // comment and E-02's corpus note): "built up from a ground plane at y=0"
  // is a generator convention, not a property every valid placement has,
  // and real released sets measurably place parts at y > 0 (e.g. hanging
  // below a hinge point). This pins the new, intentional behaviour rather
  // than leaving the gap silent: y = 24 is a multiple of 2, so it is legal
  // on its own terms now that being positive is not, by itself, a defect.
  it("E-02 does not fail merely for having a positive Y", () => {
    expect(fire(byId(l3Rules, "E-02"), "1 4 0 24 0 1 0 0 0 1 0 0 0 1 3001.dat")).toHaveLength(0);
  });

  it("E-02 fails a Y that is not a multiple of 4", () => {
    expect(fire(byId(l3Rules, "E-02"), "1 4 0 -25 0 1 0 0 0 1 0 0 0 1 3001.dat")[0]!.status).toBe("fail");
  });

  it("E-02 passes a proper stacked brick", () => {
    expect(fire(byId(l3Rules, "E-02"), "1 4 0 -24 0 1 0 0 0 1 0 0 0 1 3001.dat")).toHaveLength(0);
  });

  it("E-04 reports off-grid X/Z as DISCOURAGED, not HARD", () => {
    const f = fire(byId(l3Rules, "E-04"), "1 4 7 -24 0 1 0 0 0 1 0 0 0 1 3001.dat", "DISCOURAGED");
    expect(f[0]!.status).toBe("fail");
    expect(f[0]!.tier).toBe("DISCOURAGED");
  });

  it("E-04 passes a half-stud jumper offset of 10", () => {
    expect(fire(byId(l3Rules, "E-04"), "1 4 10 -24 0 1 0 0 0 1 0 0 0 1 3001.dat", "DISCOURAGED")).toHaveLength(0);
  });
});

describe("B-07 masonry bond", () => {
  const rule = byId(l3Rules, "B-07");

  /**
   * Drive B-07 from stud footprints directly. Footprint extents are to the
   * STUDS, so a part's outline runs half a stud pitch (10 LDU) beyond each
   * end -- studs at x=[-30,-10] is a brick occupying [-40, 0].
   */
  function fireB07(footprints: StudFootprint[]) {
    const text = footprints.map(() => "1 4 0 0 0 1 0 0 0 1 0 0 0 1 3001.dat").join("\n");
    const model = resolveModel(parseDocument(text, "t.ldr"), lib);
    model.graph = {
      edges: [],
      coverage: { withData: 0, total: 0, ratio: 1 },
      unknownPlacements: [],
      components: 1,
      componentOf: [],
      incompleteDataPlacements: [],
      fullyAccountedPlacements: [],
      degradedGridPlacements: [],
      unreliableAxisPlacements: [],
      clipOnlyPlacements: [],
      studFootprints: new Map(footprints.map((f, i) => [i, f])),
    };
    return rule.run({ model, library: lib, meta: meta("B-07") });
  }

  const brick = (y: number, x0: number, x1: number, z = 0): StudFootprint => ({
    y,
    minX: x0,
    maxX: x1,
    minZ: z,
    maxZ: z,
    count: 2,
  });

  it("fails when a seam repeats in the course directly above", () => {
    // Both courses split at x=0, one brick height (24 LDU) apart.
    const f = fireB07([
      brick(0, -30, -10),
      brick(0, 10, 30),
      brick(-24, -30, -10),
      brick(-24, 10, 30),
    ]);
    expect(f).toHaveLength(1);
    expect(f[0]!.status).toBe("fail");
    expect(f[0]!.message).toContain("x=0");
  });

  it("passes a staggered bond, where each course's seam lands over a brick below", () => {
    const f = fireB07([brick(0, -30, -10), brick(0, 10, 30), brick(-24, -10, 10), brick(-24, 30, 50)]);
    expect(f).toHaveLength(0);
  });

  it("passes single-stud parts stacked in a column", () => {
    // A column of 1x1s has no length to bond with -- it is a column by
    // design, not a wall built wrong. Admitting these once made the rule
    // fire on 26% of real sets by grouping round plates into fake courses.
    const one = (y: number, x: number): StudFootprint => ({ y, minX: x, maxX: x, minZ: 0, maxZ: 0, count: 1 });
    expect(fireB07([one(0, -10), one(0, 10), one(-24, -10), one(-24, 10)])).toHaveLength(0);
  });

  it("does not compare courses a plate apart, only a full brick apart", () => {
    const f = fireB07([brick(0, -30, -10), brick(0, 10, 30), brick(-8, -30, -10), brick(-8, 10, 30)]);
    expect(f).toHaveLength(0);
  });

  it("does not treat a repeated seam in a different z band as the same joint", () => {
    const f = fireB07([
      brick(0, -30, -10, 0),
      brick(0, 10, 30, 0),
      brick(-24, -30, -10, 200),
      brick(-24, 10, 30, 200),
    ]);
    expect(f).toHaveLength(0);
  });

  it("finds a wall running along z, not only along x", () => {
    const zBrick = (y: number, z0: number, z1: number): StudFootprint => ({
      y,
      minX: 0,
      maxX: 0,
      minZ: z0,
      maxZ: z1,
      count: 2,
    });
    const f = fireB07([zBrick(0, -30, -10), zBrick(0, 10, 30), zBrick(-24, -30, -10), zBrick(-24, 10, 30)]);
    expect(f).toHaveLength(1);
    expect(f[0]!.message).toContain("z=0");
  });

  it("returns unknown without stud footprints", () => {
    const model = resolveModel(parseDocument("1 4 0 0 0 1 0 0 0 1 0 0 0 1 3001.dat", "t.ldr"), lib);
    expect(rule.run({ model, library: lib, meta: meta("B-07") })[0]!.status).toBe("unknown");
  });
});
