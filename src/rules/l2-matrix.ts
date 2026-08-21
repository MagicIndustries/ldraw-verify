import { determinant3, isOrthonormal } from "../resolve/matrix.js";
import type { Finding, Rule, RuleContext } from "./types.js";

const SINGULAR_EPS = 1e-6;

/**
 * Tolerance for the orthonormality check specifically (not for the
 * near-zero-determinant singularity check above it, which stays tight --
 * a genuinely flattened/zero-scaled dimension is unambiguous at any
 * precision).
 *
 * 1e-6 sounds like the "obviously correct" tolerance for a should-be-exact
 * rotation, but real official LDraw files fail it almost universally: an
 * OMR set's matrices are typically authored to 6 decimal places, and that
 * single-line rounding alone lands deviations around 1e-5 to 1e-4 -- before
 * a nested submodel chain multiplies two or three independently-rounded
 * matrices together and compounds it further.
 *
 * A first measurement (1e-3) cleared ordinary rounding drift but the rule
 * still quarantined real sets. Re-measured over a corpus-wide row-norm
 * deviation histogram (see the Task 14 report), a second, distinct cluster
 * of real placements runs up to ~0.04 -- e.g. `10001-1.mpd`'s curved 9V
 * train track (`74747.dat`, aliased in that file as `2867.dat`), where
 * consecutive track segments are placed with a hand/tool-approximated
 * small-angle matrix (cosθ≈1, sinθ≈θ) instead of an exact rotation. That is
 * authoring imprecision in how a curve of real, physical track pieces was
 * positioned, not a transposed or sheared matrix -- and it stays two orders
 * of magnitude below where genuine transposition/shear deviations start
 * (~0.1, running into the hundreds; see `Placement.generatedFlexPath` in
 * `resolve/ir.ts` for a separate, much larger deviation cluster that is
 * excluded by an entirely different mechanism rather than by widening this
 * tolerance further). 0.05 clears the curved-track cluster with headroom
 * while staying well clear of that genuine-defect range.
 */
const ORTHONORMAL_EPS = 0.05;

const matrixSane: Rule = {
  id: "E-01",
  needs: ["placements"],
  run({ model, meta }: RuleContext): Finding[] {
    const out: Finding[] = [];
    for (const p of model.placements) {
      const det = determinant3(p.world);

      if (Math.abs(det) < SINGULAR_EPS) {
        // A degenerate (zero-scaled) matrix is unambiguous evidence of a
        // real defect regardless of generatedFlexPath status, so the
        // singularity check runs before, and independently of, the
        // flex-path exemption below.
        out.push({
          ruleId: meta.id,
          tier: meta.tier,
          status: "fail",
          message: "singular matrix: a dimension is scaled to zero",
          locations: [{ file: p.file, line: p.line, partId: p.partId }],
          evidence: { determinant: det },
        });
        continue;
      }

      if (!isOrthonormal(p.world, ORTHONORMAL_EPS)) {
        // LDCad's own auto-generated flexible-path fallback content (cables,
        // hoses, Technic chains/treads -- see Placement.generatedFlexPath)
        // deliberately sheared/scales each segment to follow a curve that a
        // physically flexible element is allowed to take. A non-orthonormal
        // matrix here is not evidence of a transposed or sheared *bug* --
        // it's the documented mechanism -- and this tool cannot separate a
        // genuinely wrong segment from an intentionally curve-following one
        // within that content, so it reports `unknown` rather than asserting
        // either.
        if (p.generatedFlexPath) {
          out.push({
            ruleId: meta.id,
            tier: meta.tier,
            status: "unknown",
            message:
              "matrix is non-orthonormal inside LDCad-generated flexible-path content (cable/hose/chain); this is the documented mechanism for approximating a curve with rigid segments, not evidence of a malformed matrix",
            locations: [{ file: p.file, line: p.line, partId: p.partId }],
            evidence: { determinant: det },
          });
          continue;
        }
        out.push({
          ruleId: meta.id,
          tier: meta.tier,
          status: "fail",
          message:
            "rotation is not orthonormal — the part is sheared or scaled. A common cause is emitting a column-major matrix: (a,b,c) is the FIRST ROW in LDraw",
          locations: [{ file: p.file, line: p.line, partId: p.partId }],
          evidence: { determinant: det },
        });
        continue;
      }

      if (det < 0) {
        out.push({
          ruleId: meta.id,
          tier: meta.tier,
          status: "pass",
          message: "mirrored placement (determinant -1) — legal, but verify it was intentional",
          locations: [{ file: p.file, line: p.line, partId: p.partId }],
          evidence: { determinant: det },
        });
      }
    }
    return out;
  },
};

export const l2Rules: Rule[] = [matrixSane];
