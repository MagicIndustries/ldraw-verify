import { describe, expect, it } from "vitest";
import { LibraryIndex } from "../src/library/index.js";
import { parseDocument } from "../src/parse/document.js";
import { translationOf } from "../src/resolve/matrix.js";
import { resolveModel } from "../src/resolve/resolve.js";

const lib = await LibraryIndex.fromDirectory("test/fixtures/lib");

describe("resolveModel", () => {
  it("flattens a single-block model into placements", () => {
    const doc = parseDocument("1 4 0 -24 0 1 0 0 0 1 0 0 0 1 3001.dat", "a.ldr");
    const m = resolveModel(doc, lib);
    expect(m.placements).toHaveLength(1);
    expect(m.placements[0]!.partId).toBe("3001.dat");
    expect(translationOf(m.placements[0]!.world)).toEqual([0, -24, 0]);
  });

  it("composes parent then child transforms through a submodel", () => {
    const doc = parseDocument(
      [
        "0 FILE main.ldr",
        "1 16 0 -24 0 1 0 0 0 1 0 0 0 1 wall.ldr",
        "0 FILE wall.ldr",
        "1 4 20 0 0 1 0 0 0 1 0 0 0 1 3001.dat",
      ].join("\n"),
      "m.mpd",
    );
    const m = resolveModel(doc, lib);
    expect(m.placements).toHaveLength(1);
    expect(translationOf(m.placements[0]!.world)).toEqual([20, -24, 0]);
    expect(m.placements[0]!.submodelPath).toEqual(["main.ldr", "wall.ldr"]);
  });

  it("records source file and line on every placement", () => {
    const doc = parseDocument("0 FILE main.ldr\n1 4 0 0 0 1 0 0 0 1 0 0 0 1 3001.dat", "m.mpd");
    const p = resolveModel(doc, lib).placements[0]!;
    expect(p.file).toBe("main.ldr");
    expect(p.line).toBe(2);
  });

  it("records unresolved references instead of throwing", () => {
    const doc = parseDocument("1 4 0 0 0 1 0 0 0 1 0 0 0 1 nope.dat", "a.ldr");
    const m = resolveModel(doc, lib);
    expect(m.placements).toHaveLength(0);
    expect(m.unresolved.map((u) => u.name)).toEqual(["nope.dat"]);
  });

  it("detects a submodel reference cycle and does not hang", () => {
    const doc = parseDocument(
      ["0 FILE a.ldr", "1 16 0 0 0 1 0 0 0 1 0 0 0 1 b.ldr", "0 FILE b.ldr", "1 16 0 0 0 1 0 0 0 1 0 0 0 1 a.ldr"].join("\n"),
      "m.mpd",
    );
    const m = resolveModel(doc, lib);
    expect(m.cycles.length).toBeGreaterThan(0);
  });
});
