import { translationOf } from "../resolve/matrix.js";
import type { Finding, Rule, RuleContext } from "./types.js";

const PLATE_QUARTER = 4;
const HALF_STUD = 10;
const TOL = 1e-6;

function isMultiple(v: number, m: number): boolean {
  return Math.abs(v / m - Math.round(v / m)) < TOL;
}

const yAxis: Rule = {
  id: "E-02",
  needs: ["placements"],
  run({ model, meta }: RuleContext): Finding[] {
    const out: Finding[] = [];
    for (const p of model.placements) {
      const [, y] = translationOf(p.world);
      if (y > TOL) {
        out.push({
          ruleId: meta.id,
          tier: meta.tier,
          status: "fail",
          message: `y = ${y}: in LDraw -Y is up, so a model built from a ground plane at y=0 has y <= 0`,
          locations: [{ file: p.file, line: p.line, partId: p.partId }],
          evidence: { y },
        });
        continue;
      }
      if (!isMultiple(y, PLATE_QUARTER)) {
        out.push({
          ruleId: meta.id,
          tier: meta.tier,
          status: "fail",
          message: `y = ${y} is not a multiple of ${PLATE_QUARTER} LDU`,
          locations: [{ file: p.file, line: p.line, partId: p.partId }],
          evidence: { y },
        });
      }
    }
    return out;
  },
};

const xzGrid: Rule = {
  id: "E-04",
  needs: ["placements"],
  run({ model, meta }: RuleContext): Finding[] {
    const out: Finding[] = [];
    for (const p of model.placements) {
      const [x, , z] = translationOf(p.world);
      const bad = [
        ["x", x] as const,
        ["z", z] as const,
      ].filter(([, v]) => !isMultiple(v, HALF_STUD));
      if (bad.length === 0) continue;
      out.push({
        ruleId: meta.id,
        tier: meta.tier,
        status: "fail",
        message: `off-grid placement (${bad.map(([n, v]) => `${n}=${v}`).join(", ")}); grid-aligned values are multiples of ${HALF_STUD} LDU. Legitimate for deliberate SNOT — reported, not blocking`,
        locations: [{ file: p.file, line: p.line, partId: p.partId }],
        evidence: { x, z },
      });
    }
    return out;
  },
};

export const l3Rules: Rule[] = [yAxis, xzGrid];
