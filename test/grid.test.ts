import { describe, expect, it } from "vitest";
import { expandGrid, expandGridWithStatus } from "../src/connect/grid.js";

describe("expandGrid", () => {
  it("returns a single no-op offset when there is no grid attribute", () => {
    expect(expandGrid({})).toEqual([[0, 0, 0]]);
  });

  it("expands an uncentred axis from 0 upward", () => {
    // nx=2, nz=1, dx=100, dz=0 -> two cells along X starting at 0.
    expect(expandGrid({ grid: "2 1 100 0" })).toEqual([
      [0, 0, 0],
      [100, 0, 0],
    ]);
  });

  it("expands a centred axis symmetrically about the origin", () => {
    // Both axes centred: nx=2 dx=20, nz=2 dz=20 -> a 2x2 grid centred on origin.
    const cells = expandGrid({ grid: "C 2 C 2 20 20" });
    expect(cells).toHaveLength(4);
    const sorted = [...cells].sort((a, b) => a[0] - b[0] || a[2] - b[2]);
    expect(sorted).toEqual([
      [-10, 0, -10],
      [-10, 0, 10],
      [10, 0, -10],
      [10, 0, 10],
    ]);
  });

  it("mixes a centred and an uncentred axis", () => {
    // nx=1 (uncentred, so a single cell at 0), nz=2 centred, dz=20.
    const cells = expandGrid({ grid: "1 C 2 0 20" });
    expect(cells).toHaveLength(2);
    const sorted = [...cells].sort((a, b) => a[2] - b[2]);
    expect(sorted).toEqual([
      [0, 0, -10],
      [0, 0, 10],
    ]);
  });

  it("falls back to a single offset for the unsupported three-axis extension", () => {
    // A real (rare) three-count/delta form some shadow files use; outside
    // this function's documented two-axis scope.
    expect(expandGrid({ grid: "1 2 1 0 -76 0" })).toEqual([[0, 0, 0]]);
  });
});

describe("expandGridWithStatus", () => {
  it("reports degraded: false when there is no grid attribute at all", () => {
    expect(expandGridWithStatus({})).toEqual({ offsets: [[0, 0, 0]], degraded: false });
  });

  it("reports degraded: false for a cleanly-parsed two-axis grid", () => {
    const result = expandGridWithStatus({ grid: "2 1 100 0" });
    expect(result.degraded).toBe(false);
    expect(result.offsets).toEqual([
      [0, 0, 0],
      [100, 0, 0],
    ]);
  });

  it("reports degraded: true, with the single-cell fallback, for the three-axis extension", () => {
    // Same real-world three-count/delta form as the expandGrid test above —
    // this is the case a caller needs to be able to detect, since it's the
    // one where cells are silently dropped rather than expanded.
    expect(expandGridWithStatus({ grid: "1 2 1 0 -76 0" })).toEqual({
      offsets: [[0, 0, 0]],
      degraded: true,
    });
  });

  it("reports degraded: true for a grid value that doesn't parse as any known form", () => {
    expect(expandGridWithStatus({ grid: "not a grid" }).degraded).toBe(true);
  });
});
