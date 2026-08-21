import { determinant3, isOrthonormal, ORTHONORMALITY_EPS, SINGULAR_DET_EPS } from "../resolve/matrix.js";
import type { Finding, Rule, RuleContext } from "./types.js";

/*
 * Both tolerances this rule needs -- the near-zero-determinant singularity
 * bound and the orthonormality bound -- now live in `src/resolve/matrix.ts`
 * alongside the predicates that apply them (`SINGULAR_DET_EPS`,
 * `ORTHONORMALITY_EPS`), because they are not E-01's private business:
 * B-05 (src/rules/l5-legality.ts) asks the identical "is this still a valid
 * rotation" question about the identical matrix, and used to answer it at
 * 1e-6 while this rule answered at 0.05 -- so the two rules contradicted
 * each other about the same placement. See those constants' doc comments
 * for the corpus measurement behind each value, including why no epsilon
 * can make this check detect a TRANSPOSED rotation.
 */

const matrixSane: Rule = {
  id: "E-01",
  needs: ["placements"],
  run({ model, meta }: RuleContext): Finding[] {
    const out: Finding[] = [];
    for (const p of model.placements) {
      const det = determinant3(p.world);

      if (Math.abs(det) < SINGULAR_DET_EPS) {
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

      if (!isOrthonormal(p.world, ORTHONORMALITY_EPS)) {
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
          // NOT a row/column-major (transposed) matrix: transpose(R) of a
          // genuine rotation R is itself orthonormal, so it would never
          // reach this branch -- see E-01's note in
          // rules/lego-build-rules.yaml. This branch only fires for a
          // singular, sheared, or non-uniformly scaled transform.
          message:
            "rotation is not orthonormal — the transform is sheared or non-uniformly scaled. (This check cannot detect a transposed row/column-major matrix: a transposed rotation is itself orthonormal and would pass undetected.)",
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
