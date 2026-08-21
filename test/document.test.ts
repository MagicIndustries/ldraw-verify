import { describe, expect, it } from "vitest";
import { parseDocument } from "../src/parse/document.js";

const MPD = [
  "0 FILE main.ldr",
  "0 Main Model",
  "1 4 0 0 0 1 0 0 0 1 0 0 0 1 wall.ldr",
  "0 NOFILE",
  "0 FILE wall.ldr",
  "1 4 0 -24 0 1 0 0 0 1 0 0 0 1 3001.dat",
].join("\r\n");

describe("parseDocument", () => {
  it("splits MPD blocks into a flat list with the first FILE as main model", () => {
    const doc = parseDocument(MPD, "m.mpd");
    expect(doc.blocks.map((b) => b.name)).toEqual(["main.ldr", "wall.ldr"]);
    expect(doc.errors).toEqual([]);
  });

  it("assigns lines to the block they appear in", () => {
    const doc = parseDocument(MPD, "m.mpd");
    expect(doc.blocks[1]!.lines.filter((l) => l.kind === "subfile")).toHaveLength(1);
  });

  it("treats a file with no FILE meta as a single block named after the path", () => {
    const doc = parseDocument("1 4 0 0 0 1 0 0 0 1 0 0 0 1 3001.dat", "solo.ldr");
    expect(doc.blocks).toHaveLength(1);
    expect(doc.blocks[0]!.name).toBe("solo.ldr");
  });

  it("errors on content before the first FILE in a multi-block file", () => {
    const doc = parseDocument("1 4 0 0 0 1 0 0 0 1 0 0 0 1 a.dat\r\n0 FILE b.ldr\r\n0 FILE c.ldr", "x.mpd");
    expect(doc.errors.some((e) => e.code === "L0_CONTENT_BEFORE_FILE")).toBe(true);
    // The stray content must not fabricate a phantom block: blocks[0] is still
    // the first real 0 FILE block, and there are exactly two real blocks.
    expect(doc.blocks).toHaveLength(2);
    expect(doc.blocks[0]!.name).toBe("b.ldr");
    expect(doc.blocks[1]!.name).toBe("c.ldr");
  });

  it("errors on duplicate FILE names", () => {
    const doc = parseDocument("0 FILE a.ldr\r\n0 FILE a.ldr", "x.mpd");
    expect(doc.errors.some((e) => e.code === "L1_DUPLICATE_FILE")).toBe(true);
    expect(doc.blocks).toHaveLength(2);
    expect(doc.blocks[0]!.name).toBe("a.ldr");
  });

  it("errors on content orphaned between NOFILE and the next FILE, without fabricating a block", () => {
    const doc = parseDocument(
      ["0 FILE a.ldr", "0 NOFILE", "1 4 0 0 0 1 0 0 0 1 0 0 0 1 orphan.dat", "0 FILE b.ldr"].join("\r\n"),
      "x.mpd",
    );
    expect(doc.errors.some((e) => e.code === "L0_ORPHANED_CONTENT")).toBe(true);
    expect(doc.blocks).toHaveLength(2);
    expect(doc.blocks.map((b) => b.name)).toEqual(["a.ldr", "b.ldr"]);
  });

  it("keeps the first real FILE block as blocks[0] when stray content precedes it", () => {
    const doc = parseDocument(
      ["1 4 0 0 0 1 0 0 0 1 0 0 0 1 stray.dat", "0 FILE main.ldr", "0 NOFILE"].join("\r\n"),
      "x.mpd",
    );
    expect(doc.blocks).toHaveLength(1);
    expect(doc.blocks[0]!.name).toBe("main.ldr");
    expect(doc.errors.some((e) => e.code === "L0_CONTENT_BEFORE_FILE")).toBe(true);
  });

  it("still parses a well-formed FILE/NOFILE/FILE document to exactly two blocks with no errors", () => {
    const doc = parseDocument(MPD, "m.mpd");
    expect(doc.blocks).toHaveLength(2);
    expect(doc.errors).toEqual([]);
  });

  it("collects tokenizer errors rather than throwing", () => {
    const doc = parseDocument("0 FILE a.ldr\r\n1 4 0 0 0 bad.dat", "x.mpd");
    expect(doc.errors.some((e) => e.code === "L0_TOKEN_COUNT")).toBe(true);
  });

  it("tolerates LF-only input", () => {
    expect(parseDocument("0 FILE a.ldr\n0 FILE b.ldr", "x.mpd").blocks).toHaveLength(2);
  });
});
