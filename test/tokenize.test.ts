import { describe, expect, it } from "vitest";
import { tokenizeLine } from "../src/parse/tokenize.js";

describe("tokenizeLine", () => {
  it("parses a type-1 subfile reference with row-major matrix", () => {
    const r = tokenizeLine("1 4 0 -24 0 1 0 0 0 1 0 0 0 1 3001.dat", 7);
    expect(r.kind).toBe("subfile");
    if (r.kind !== "subfile") return;
    expect(r.colour).toBe(4);
    expect(r.pos).toEqual([0, -24, 0]);
    expect(r.mat).toEqual([1, 0, 0, 0, 1, 0, 0, 0, 1]);
    expect(r.name).toBe("3001.dat");
    expect(r.line).toBe(7);
  });

  it("keeps filenames containing spaces intact", () => {
    const r = tokenizeLine("1 16 0 0 0 1 0 0 0 1 0 0 0 1 my sub model.ldr", 1);
    expect(r.kind === "subfile" && r.name).toBe("my sub model.ldr");
  });

  it("rejects a type-1 line with too few tokens", () => {
    const r = tokenizeLine("1 4 0 -24 0 1 0 0 3001.dat", 3);
    expect(r.kind).toBe("error");
    expect(r.kind === "error" && r.code).toBe("L0_TOKEN_COUNT");
  });

  it("rejects non-numeric coordinates", () => {
    const r = tokenizeLine("1 4 x -24 0 1 0 0 0 1 0 0 0 1 3001.dat", 3);
    expect(r.kind).toBe("error");
    expect(r.kind === "error" && r.code).toBe("L0_NON_NUMERIC");
  });

  it("parses a meta line", () => {
    const r = tokenizeLine("0 FILE main.ldr", 1);
    expect(r.kind).toBe("meta");
    expect(r.kind === "meta" && r.text).toBe("FILE main.ldr");
  });

  it("parses a type-3 triangle with 9 coordinates", () => {
    const r = tokenizeLine("3 16 0 0 0 1 0 0 0 0 1", 2);
    expect(r.kind).toBe("geom");
    expect(r.kind === "geom" && r.coords.length).toBe(9);
  });

  it("treats a blank line as an empty meta line", () => {
    expect(tokenizeLine("   ", 9).kind).toBe("meta");
  });
});
