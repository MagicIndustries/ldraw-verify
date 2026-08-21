import type { Mat3, Vec3 } from "../parse/ast.js";

/** Row-major 4x4. Rows 0..2 hold rotation and translation; row 3 is 0,0,0,1. */
export type Mat4 = readonly number[];

export const IDENTITY4: Mat4 = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];

export function fromLdraw(pos: Vec3, m: Mat3): Mat4 {
  return [
    m[0], m[1], m[2], pos[0],
    m[3], m[4], m[5], pos[1],
    m[6], m[7], m[8], pos[2],
    0, 0, 0, 1,
  ];
}

export function multiply(a: Mat4, b: Mat4): Mat4 {
  const out = new Array<number>(16).fill(0);
  for (let r = 0; r < 4; r++) {
    for (let c = 0; c < 4; c++) {
      let s = 0;
      for (let k = 0; k < 4; k++) s += a[r * 4 + k]! * b[k * 4 + c]!;
      out[r * 4 + c] = s;
    }
  }
  return out;
}

export function applyPoint(m: Mat4, p: Vec3): Vec3 {
  return [
    m[0]! * p[0] + m[1]! * p[1] + m[2]! * p[2] + m[3]!,
    m[4]! * p[0] + m[5]! * p[1] + m[6]! * p[2] + m[7]!,
    m[8]! * p[0] + m[9]! * p[1] + m[10]! * p[2] + m[11]!,
  ];
}

export function applyDir(m: Mat4, v: Vec3): Vec3 {
  return [
    m[0]! * v[0] + m[1]! * v[1] + m[2]! * v[2],
    m[4]! * v[0] + m[5]! * v[1] + m[6]! * v[2],
    m[8]! * v[0] + m[9]! * v[1] + m[10]! * v[2],
  ];
}

export function translationOf(m: Mat4): Vec3 {
  return [m[3]!, m[7]!, m[11]!];
}

export function determinant3(m: Mat4): number {
  const [a, b, c] = [m[0]!, m[1]!, m[2]!];
  const [d, e, f] = [m[4]!, m[5]!, m[6]!];
  const [g, h, i] = [m[8]!, m[9]!, m[10]!];
  return a * (e * i - f * h) - b * (d * i - f * g) + c * (d * h - e * g);
}

/**
 * True when the rotation part is orthonormal. Guards against emitter
 * transposition-with-scale bugs and sheared transforms.
 */
export function isOrthonormal(m: Mat4, eps = 1e-6): boolean {
  const rows: Vec3[] = [
    [m[0]!, m[1]!, m[2]!],
    [m[4]!, m[5]!, m[6]!],
    [m[8]!, m[9]!, m[10]!],
  ];
  for (let i = 0; i < 3; i++) {
    const ri = rows[i]!;
    const norm = Math.hypot(ri[0], ri[1], ri[2]);
    if (Math.abs(norm - 1) > eps) return false;
    for (let j = i + 1; j < 3; j++) {
      const rj = rows[j]!;
      const dot = ri[0] * rj[0] + ri[1] * rj[1] + ri[2] * rj[2];
      if (Math.abs(dot) > eps) return false;
    }
  }
  return true;
}
