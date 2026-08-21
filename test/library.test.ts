import { describe, expect, it } from "vitest";
import { LibraryIndex } from "../src/library/index.js";

describe("LibraryIndex", () => {
  it("indexes parts by lowercase filename", async () => {
    const lib = await LibraryIndex.fromDirectory("test/fixtures/lib");
    expect(lib.has("3001.dat")).toBe(true);
    expect(lib.has("3001.DAT")).toBe(true);
    expect(lib.get("3001.dat")!.description).toBe("Brick  2 x  4");
  });

  it("flags ~Moved to aliases and records the target", async () => {
    const lib = await LibraryIndex.fromDirectory("test/fixtures/lib");
    const p = lib.get("3040.dat")!;
    expect(p.isAlias).toBe(true);
    expect(p.movedTo).toBe("3040b");
  });

  it("flags any ~-prefixed description as hidden", async () => {
    const lib = await LibraryIndex.fromDirectory("test/fixtures/lib");
    expect(lib.get("3040.dat")!.isHidden).toBe(true);
    expect(lib.get("3001.dat")!.isHidden).toBe(false);
  });

  it("returns undefined for an unknown part", async () => {
    const lib = await LibraryIndex.fromDirectory("test/fixtures/lib");
    expect(lib.get("9999999.dat")).toBeUndefined();
  });
});
