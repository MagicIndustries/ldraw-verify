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

  it("E-02 fails a positive Y translation", () => {
    const f = fire(byId(l3Rules, "E-02"), "1 4 0 24 0 1 0 0 0 1 0 0 0 1 3001.dat");
    expect(f[0]!.status).toBe("fail");
    expect(f[0]!.message).toContain("-Y is up");
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
