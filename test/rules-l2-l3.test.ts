import { describe, expect, it } from "vitest";
import { LibraryIndex } from "../src/library/index.js";
import { parseDocument } from "../src/parse/document.js";
import { resolveModel } from "../src/resolve/resolve.js";
import { l2Rules } from "../src/rules/l2-matrix.js";
import { l3Rules } from "../src/rules/l3-grid.js";
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
