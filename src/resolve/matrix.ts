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

/*
 * ---------------------------------------------------------------------
 * Matrix tolerances. THREE distinct quantities, each named for what it
 * measures, and each with exactly one definition.
 *
 * This block exists because the same three numbers were previously spread
 * across five modules under three different spellings -- two constants
 * both called `AXIS_TOL`/`AXIS_EPS` that measured rotation-block ENTRIES
 * at two different values (1e-3 in l3-grid.ts, 1e-6 in l5-legality.ts),
 * plus a third `AXIS_TOL` in connect/graph.ts measuring something else
 * entirely (a cosine between two hotspot axes). The 1e-6 entry tolerance
 * was the value this project had already MEASURED to be unrealistic
 * against real files, and B-05 kept using it while E-01 did not, so the
 * two rules contradicted each other about the same matrix. Same quantity,
 * one constant; different quantity, different name.
 *
 * The remaining `HOTSPOT_AXIS_COS_TOL` (connect/graph.ts) is deliberately
 * NOT here: it is a cosine between two world-space hotspot directions, not
 * a matrix entry, and lives with the pairing code that is its only
 * consumer.
 * ---------------------------------------------------------------------
 */

/**
 * Magnitude below which |det(R)| counts as degenerate -- a dimension
 * scaled to zero. Stays tight: a genuinely flattened transform is
 * unambiguous at any precision (a real rotation has |det| == 1, so there
 * is no rounding drift anywhere near zero to accommodate).
 */
export const SINGULAR_DET_EPS = 1e-6;

/**
 * Maximum deviation of a rotation row's norm from 1, or of two rotation
 * rows' dot product from 0, before the transform counts as sheared or
 * non-uniformly scaled rather than a valid rotation.
 *
 * Measured, not assumed: real OMR files author matrices to 6 decimal
 * places and compound two or three independently-rounded matrices through
 * nested submodels, and a second real cluster (10001-1.mpd's curved 9V
 * track, placed with a hand-approximated small-angle matrix) runs up to
 * ~0.04 row-norm deviation while being a perfectly legitimate placement of
 * real, physical track pieces. Genuine shear/scale defects start around
 * ~0.1 and run into the hundreds. 0.05 clears the curved-track cluster
 * with headroom and stays well clear of the defect range. See E-01's note
 * in rules/lego-build-rules.yaml for the full measurement.
 *
 * Consumers: E-01 (src/rules/l2-matrix.ts), B-05's well-formedness gate
 * (src/rules/l5-legality.ts), and the composed-transform check in
 * src/connect/closure.ts. All three ask the SAME question -- "is this
 * still a valid rotation at all" -- so all three share this value. B-05
 * using a different one is exactly the drift this constant exists to stop.
 */
export const ORTHONORMALITY_EPS = 0.05;

/**
 * Maximum deviation of a single rotation-block ENTRY from 0 or +-1 before
 * the rotation stops counting as a multiple of 90 degrees.
 *
 * Deliberately ~50x tighter than `ORTHONORMALITY_EPS`, because it answers
 * a different question. Orthonormality only has to tolerate the noisiest
 * real, non-defective rotation (the ~0.04 curved-track cluster).
 * Axis-alignment has to REJECT that same cluster: a small-angle
 * approximated rotation is precisely a near-but-not-actually-aligned
 * rotation, and widening this to 0.05 would wrongly read it as
 * axis-aligned. 1e-3 clears ordinary 6-decimal rounding and nested-
 * submodel compounding while staying well under that cluster's ~0.04
 * floor.
 *
 * Consumers: E-02 and E-04 (src/rules/l3-grid.ts, as the decidability gate
 * on a world-frame grid claim) and B-05 (src/rules/l5-legality.ts, as the
 * sub-detent-rotation test itself).
 */
export const AXIS_ALIGNED_ENTRY_EPS = 1e-3;

/**
 * True when the rotation part is orthonormal. Guards against singular,
 * sheared, and non-uniformly scaled transforms.
 *
 * Does NOT detect a pure transposition of a genuine rotation matrix (the
 * row-major/column-major mixup that is the single most common LDraw
 * generator bug): for a genuine rotation R, transpose(R) == inverse(R),
 * which is itself orthonormal with determinant +1. A transposed rotation is
 * a perfectly well-formed rotation, just the wrong one -- no orthonormality
 * or determinant test can distinguish forward from transposed, at any
 * tolerance. Detecting that requires knowing the intended geometry, which a
 * verifier reading a single file does not have. See E-01's note in
 * rules/lego-build-rules.yaml and `not_checkable` there.
 */
export function isOrthonormal(m: Mat4, eps = ORTHONORMALITY_EPS): boolean {
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

/**
 * True when `m`'s rotation is both well-formed (see `isOrthonormal`) and a
 * multiple of 90 degrees on every axis -- every entry of the 3x3 rotation
 * block is 0 or +-1, which is only possible for a 0/90/180/270-degree
 * rotation on an orthonormal matrix (see `src/rules/l5-legality.ts`'s B-05
 * doc comment for the proof sketch).
 *
 * This is `world`-space alignment, i.e. it is composed through every
 * ancestor submodel's own transform, not just the placement's own local
 * line. That distinction matters for a grid check like E-02
 * (`src/rules/l3-grid.ts`): "this part's Y sits on a multiple of 4 LDU" is
 * only a meaningful claim in an axis-aligned frame. The moment any ancestor
 * submodel is itself rotated off a 90-degree multiple -- an angled roof
 * section, a train bogie following curved track, a tilted decorative
 * assembly, all routine in real released sets -- every descendant's
 * composed world Y stops being a clean multiple of anything, even though
 * the part sits exactly on-grid in its own submodel's local frame. Callers
 * that only make sense in an axis-aligned frame should treat `false` here
 * as "not decidable", not as "off-grid".
 *
 * `eps` is an ENTRY tolerance (`AXIS_ALIGNED_ENTRY_EPS`), and it is
 * applied to the well-formedness gate as well as to the per-entry test.
 * That makes `false` mean either "not a rotation" or "a rotation, but not
 * a 90-degree multiple" -- indistinguishable from the return value alone.
 * That is what E-02/E-04 want (both are `unknown` either way: a world-frame
 * grid claim is equally undecidable through a sheared ancestor as through
 * a rotated one). A caller that must tell the two apart -- B-05, which
 * reports `unknown` for the first and `fail` for the second -- has to
 * check `isOrthonormal(m, ORTHONORMALITY_EPS)` itself first, at the
 * orthonormality tolerance, so that its answer cannot contradict E-01's on
 * the same matrix.
 */
export function isAxisAligned(m: Mat4, eps = AXIS_ALIGNED_ENTRY_EPS): boolean {
  if (Math.abs(determinant3(m)) < eps) return false;
  if (!isOrthonormal(m, eps)) return false;
  // Every entry of the rotation block is 0 or +-1 exactly when each of its
  // three rows is itself an axis direction -- the same per-entry test,
  // taken from the one place it is defined rather than repeated here.
  const rows: Vec3[] = [
    [m[0]!, m[1]!, m[2]!],
    [m[4]!, m[5]!, m[6]!],
    [m[8]!, m[9]!, m[10]!],
  ];
  return rows.every((r) => isAxisAlignedDirection(r, eps));
}

/**
 * True when a unit DIRECTION points along a coordinate axis -- every
 * component 0 or +-1, which is the same per-entry test `isAxisAligned`
 * applies to a whole rotation block, at the same `AXIS_ALIGNED_ENTRY_EPS`.
 *
 * Same quantity, one constant. This exists so B-05's "does this placement
 * carry the part's own free axis to a grid direction?" question cannot
 * drift away from the tolerance its axis-alignment test already uses --
 * the drift this file's tolerance block was written to stop. `isAxisAligned`
 * is expressed in terms of it for the same reason.
 *
 * Assumes `v` is unit length (every caller normalises first): 0/+-1 per
 * component only characterises an axis direction for a unit vector.
 */
export function isAxisAlignedDirection(v: Vec3, eps = AXIS_ALIGNED_ENTRY_EPS): boolean {
  return v.every((c) => Math.abs(c) < eps || Math.abs(Math.abs(c) - 1) < eps);
}
