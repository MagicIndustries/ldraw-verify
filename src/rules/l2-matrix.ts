import { determinant3, isOrthonormal } from "../resolve/matrix.js";
import type { Finding, Rule, RuleContext } from "./types.js";

const EPS = 1e-6;

const matrixSane: Rule = {
  id: "E-01",
  needs: ["placements"],
  run({ model, meta }: RuleContext): Finding[] {
    const out: Finding[] = [];
    for (const p of model.placements) {
      const det = determinant3(p.world);

      if (Math.abs(det) < EPS) {
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

      if (!isOrthonormal(p.world, EPS)) {
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
