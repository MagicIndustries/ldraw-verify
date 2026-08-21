import { describe, expect, it } from "vitest";
import { LibraryIndex } from "../src/library/index.js";
import { parseDocument } from "../src/parse/document.js";
import { resolveModel } from "../src/resolve/resolve.js";
import { l0Rules } from "../src/rules/l0-syntax.js";
import { l1Rules } from "../src/rules/l1-references.js";
import type { Rule, RuleMeta } from "../src/rules/types.js";

const lib = await LibraryIndex.fromDirectory("test/fixtures/lib");
const meta = (id: string): RuleMeta => ({ id, name: id, tier: "HARD", statement: "" });

function fire(rule: Rule, text: string) {
  const model = resolveModel(parseDocument(text, "t.ldr"), lib);
  return rule.run({ model, library: lib, meta: meta(rule.id) });
}

const byId = (rules: Rule[], id: string) => rules.find((r) => r.id === id)!;

describe("L0/L1 rules", () => {
  it("E-03 fails on colour 16 at the top level", () => {
    const f = fire(byId(l0Rules, "E-03"), "1 16 0 0 0 1 0 0 0 1 0 0 0 1 3001.dat");
    expect(f[0]!.status).toBe("fail");
    expect(f[0]!.locations[0]!.line).toBe(1);
  });

  it("E-03 fails on colour 24 at the top level", () => {
    expect(fire(byId(l0Rules, "E-03"), "1 24 0 0 0 1 0 0 0 1 0 0 0 1 3001.dat")[0]!.status).toBe("fail");
  });

  it("E-03 passes on a concrete colour", () => {
    expect(fire(byId(l0Rules, "E-03"), "1 4 0 0 0 1 0 0 0 1 0 0 0 1 3001.dat")).toHaveLength(0);
  });

  it("E-05 fails on content before the first FILE", () => {
    const f = fire(byId(l0Rules, "E-05"), "1 4 0 0 0 1 0 0 0 1 0 0 0 1 3001.dat\n0 FILE a.ldr\n0 FILE b.ldr");
    expect(f[0]!.status).toBe("fail");
  });

  it("E-05 fails on a reference cycle", () => {
    const f = fire(
      byId(l0Rules, "E-05"),
      ["0 FILE a.ldr", "1 16 0 0 0 1 0 0 0 1 0 0 0 1 b.ldr", "0 FILE b.ldr", "1 16 0 0 0 1 0 0 0 1 0 0 0 1 a.ldr"].join("\n"),
    );
    expect(f.some((x) => x.status === "fail")).toBe(true);
  });

  it("E-08 fails on an unresolved part", () => {
    const f = fire(byId(l1Rules, "E-08"), "1 4 0 0 0 1 0 0 0 1 0 0 0 1 nope.dat");
    expect(f[0]!.status).toBe("fail");
    expect(f[0]!.message).toContain("nope.dat");
  });

  it("E-07 fails on a ~Moved to alias and names the target", () => {
    const f = fire(byId(l1Rules, "E-07"), "1 4 0 0 0 1 0 0 0 1 0 0 0 1 3040.dat");
    expect(f[0]!.status).toBe("fail");
    expect(f[0]!.message).toContain("3040b");
  });

  it("E-07 passes on a current part", () => {
    expect(fire(byId(l1Rules, "E-07"), "1 4 0 0 0 1 0 0 0 1 0 0 0 1 3001.dat")).toHaveLength(0);
  });
});
