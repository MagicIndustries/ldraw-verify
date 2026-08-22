import { describe, expect, it } from "vitest";
import {
  applyDir,
  applyPoint,
  determinant3,
  fromLdraw,
  IDENTITY4,
  isAxisAligned,
  isOrthonormal,
  multiply,
  translationOf,
} from "../src/resolve/matrix.js";

// 90 degrees about Y, taken verbatim from LDraw's own reference model car.ldr
const ROT_Y90 = [0, 0, 1, 0, 1, 0, -1, 0, 0] as const;

// 180 degrees about X: cos(180)=-1, sin(180)=0.
const ROT_X180 = [1, 0, 0, 0, -1, 0, 0, 0, -1] as const;

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

  describe("isAxisAligned", () => {
    it("passes axis-aligned 90-degree rotations", () => {
      expect(isAxisAligned(fromLdraw([0, 0, 0], ROT_Y90))).toBe(true);
      expect(isAxisAligned(fromLdraw([0, 0, 0], ROT_X180))).toBe(true);
      expect(isAxisAligned(IDENTITY4)).toBe(true);
    });

    it("reports a small-angle rotation (1 degree about Y) as not aligned", () => {
      const cos1 = 0.9998476951563913;
      const sin1 = 0.01745240643728351;
      const m = fromLdraw([0, 0, 0], [cos1, 0, sin1, 0, 1, 0, -sin1, 0, cos1]);
      // Well-formed (a genuine, if imprecisely-authored, rotation) but not
      // a multiple of 90 degrees -- must be reported as not decidable as
      // axis-aligned, not silently rounded to the nearest 90.
      expect(isAxisAligned(m)).toBe(false);
    });

    it("reports an arbitrary 45-degree rotation about Y as not aligned", () => {
      const c = Math.SQRT1_2;
      const m = fromLdraw([0, 0, 0], [c, 0, c, 0, 1, 0, -c, 0, c]);
      expect(isAxisAligned(m)).toBe(false);
    });

    it("pins behaviour at the tolerance boundary", () => {
      // A rotation whose off-axis entries are exactly 0.005 -- deliberately
      // straddling two epsilons used elsewhere in this codebase
      // (AXIS_ALIGNED_ENTRY_EPS = 1e-3, ORTHONORMALITY_EPS = 0.05, both
      // defined in src/resolve/matrix.ts) so this test pins the boundary
      // rather than just the interior.
      const s = 0.005;
      const c = Math.sqrt(1 - s * s);
      const m = fromLdraw([0, 0, 0], [c, 0, s, 0, 1, 0, -s, 0, c]);
      // Looser than 0.005: the off-axis entries round to 0 and the
      // near-1 entries round to 1, so this reads as aligned.
      expect(isAxisAligned(m, 0.01)).toBe(true);
      // Tighter than 0.005: the same entries no longer round away, so
      // this reads as not aligned -- the same matrix, opposite verdict,
      // purely as a function of the epsilon passed in.
      expect(isAxisAligned(m, 0.001)).toBe(false);
    });

    it("reports a singular matrix as not aligned, not as vacuously aligned", () => {
      // A zero-scaled dimension can have every rotation-block entry in
      // {0, 1} (e.g. a duplicated row) while not being a rotation at all;
      // isAxisAligned must reject it via the determinant gate rather than
      // reading its entries as trivially "aligned".
      const m = fromLdraw([0, 0, 0], [1, 0, 0, 0, 0, 0, 0, 0, 1]);
      expect(isAxisAligned(m)).toBe(false);
    });
  });
});
