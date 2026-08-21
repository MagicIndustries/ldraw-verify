import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import { LibraryIndex } from "../src/library/index.js";
import { parseDocument } from "../src/parse/document.js";
import { resolveModel } from "../src/resolve/resolve.js";
import { E05_OWNED_CODES, E10_OWNED_CODES, l0Rules } from "../src/rules/l0-syntax.js";
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

  it("E-07 fails on a ~-prefixed hidden part that is not a Moved-to alias, without claiming a replacement", () => {
    const f = fire(byId(l1Rules, "E-07"), "1 4 0 0 0 1 0 0 0 1 0 0 0 1 hidden1.dat");
    expect(f[0]!.status).toBe("fail");
    expect(f[0]!.message).toContain("~-prefixed");
    expect(f[0]!.message).not.toContain("instead");
  });

  it("E-05 fails on content orphaned between 0 NOFILE and the next 0 FILE", () => {
    const f = fire(
      byId(l0Rules, "E-05"),
      [
        "0 FILE a.ldr",
        "1 4 0 0 0 1 0 0 0 1 0 0 0 1 3001.dat",
        "0 NOFILE",
        "1 4 0 0 0 1 0 0 0 1 0 0 0 1 3001.dat",
        "0 FILE b.ldr",
      ].join("\n"),
    );
    expect(f.some((x) => x.status === "fail" && x.evidence?.["code"] === "L0_ORPHANED_CONTENT")).toBe(true);
  });

  it("E-10 fails on a token-count error", () => {
    const f = fire(byId(l0Rules, "E-10"), "1 16 0 0 0 3001.dat");
    expect(f[0]!.status).toBe("fail");
    expect(f[0]!.evidence?.["code"]).toBe("L0_TOKEN_COUNT");
  });

  it("E-10 fails on a non-numeric field error", () => {
    const f = fire(byId(l0Rules, "E-10"), "1 4 0 0 0 1 0 0 0 1 0 0 0 x 3001.dat");
    expect(f[0]!.status).toBe("fail");
    expect(f[0]!.evidence?.["code"]).toBe("L0_NON_NUMERIC");
  });

  it("E-10 fails on an unknown line-type error", () => {
    const f = fire(byId(l0Rules, "E-10"), "9 bogus line");
    expect(f[0]!.status).toBe("fail");
    expect(f[0]!.evidence?.["code"]).toBe("L0_LINE_TYPE");
  });

  it("E-10 passes on a well-formed file", () => {
    expect(fire(byId(l0Rules, "E-10"), "1 4 0 0 0 1 0 0 0 1 0 0 0 1 3001.dat")).toHaveLength(0);
  });

  it("E-03 fails on a colour-24 type-1 line inside a submodel block", () => {
    const f = fire(
      byId(l0Rules, "E-03"),
      [
        "0 FILE a.ldr",
        "1 4 0 0 0 1 0 0 0 1 0 0 0 1 b.ldr",
        "0 FILE b.ldr",
        "1 24 0 0 0 1 0 0 0 1 0 0 0 1 3001.dat",
      ].join("\n"),
    );
    expect(f.some((x) => x.status === "fail" && x.evidence?.["colour"] === 24)).toBe(true);
  });

  it("E-03 passes on a colour-16 type-1 line inside a submodel block", () => {
    const f = fire(
      byId(l0Rules, "E-03"),
      [
        "0 FILE a.ldr",
        "1 4 0 0 0 1 0 0 0 1 0 0 0 1 b.ldr",
        "0 FILE b.ldr",
        "1 16 0 0 0 1 0 0 0 1 0 0 0 1 3001.dat",
      ].join("\n"),
    );
    expect(f).toHaveLength(0);
  });

  it("declares the full set of parser error codes as owned by exactly one rule, with no gaps or overlap", async () => {
    const [documentSrc, tokenizeSrc] = await Promise.all([
      readFile(new URL("../src/parse/document.ts", import.meta.url), "utf8"),
      readFile(new URL("../src/parse/tokenize.ts", import.meta.url), "utf8"),
    ]);
    const emitted = new Set<string>();
    for (const src of [documentSrc, tokenizeSrc]) {
      for (const m of src.matchAll(/"(L\d_[A-Z_]+)"/g)) emitted.add(m[1]!);
    }
    // Sanity check that the scrape itself is working and isn't silently matching nothing.
    expect(emitted.size).toBeGreaterThan(0);

    const overlap = E05_OWNED_CODES.filter((c) => E10_OWNED_CODES.includes(c));
    expect(overlap).toEqual([]);

    const owned = new Set<string>([...E05_OWNED_CODES, ...E10_OWNED_CODES]);
    expect(owned).toEqual(emitted);
  });
});
