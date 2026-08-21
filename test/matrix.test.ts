import { describe, expect, it } from "vitest";
import { applyDir, applyPoint, determinant3, fromLdraw, IDENTITY4, isOrthonormal, multiply, translationOf } from "../src/resolve/matrix.js";

// 90 degrees about Y, taken verbatim from LDraw's own reference model car.ldr
const ROT_Y90 = [0, 0, 1, 0, 1, 0, -1, 0, 0] as const;

describe("matrix", () => {
  it("treats (a,b,c) as the first row, so (a,d,g) is the image of X", () => {
    const m = fromLdraw([0, 0, 0], ROT_Y90);
    // X axis maps to (a,d,g) = (0,0,-1)
    expect(applyDir(m, [1, 0, 0]).map(Math.round)).toEqual([0, 0, -1]);
  });

  it("applies translation to a point", () => {
    const m = fromLdraw([10, -24, 30], [1, 0, 0, 0, 1, 0, 0, 0, 1]);
    expect(applyPoint(m, [0, 0, 0])).toEqual([10, -24, 30]);
  });

  it("ignores translation for a direction", () => {
    const m = fromLdraw([10, -24, 30], [1, 0, 0, 0, 1, 0, 0, 0, 1]);
    expect(applyDir(m, [0, -1, 0])).toEqual([0, -1, 0]);
  });

  it("composes parent then child", () => {
    const parent = fromLdraw([0, -24, 0], [1, 0, 0, 0, 1, 0, 0, 0, 1]);
    const child = fromLdraw([20, 0, 0], [1, 0, 0, 0, 1, 0, 0, 0, 1]);
    expect(translationOf(multiply(parent, child))).toEqual([20, -24, 0]);
  });

  it("reports determinant +1 for a proper rotation", () => {
    expect(determinant3(fromLdraw([0, 0, 0], ROT_Y90))).toBeCloseTo(1, 9);
  });

  it("reports determinant -1 for a mirrored placement", () => {
    expect(determinant3(fromLdraw([0, 0, 0], [-1, 0, 0, 0, 1, 0, 0, 0, 1]))).toBeCloseTo(-1, 9);
  });

  it("detects a non-orthonormal (sheared) matrix", () => {
    expect(isOrthonormal(fromLdraw([0, 0, 0], [1, 0.5, 0, 0, 1, 0, 0, 0, 1]))).toBe(false);
    expect(isOrthonormal(fromLdraw([0, 0, 0], ROT_Y90))).toBe(true);
  });

  it("has an identity that leaves points unchanged", () => {
    expect(applyPoint(IDENTITY4, [1, 2, 3])).toEqual([1, 2, 3]);
  });
});
