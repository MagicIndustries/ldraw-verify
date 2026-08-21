import { isAxisAligned, translationOf } from "../resolve/matrix.js";
import type { Finding, Rule, RuleContext } from "./types.js";

const PLATE_QUARTER = 4;
const HALF_STUD = 10;
const TOL = 1e-6;

/**
 * Tolerance for `isAxisAligned`'s well-formedness and 90-degree-multiple
 * checks. See `ORTHONORMAL_EPS` in `l2-matrix.ts` for why 1e-6 is
 * unrealistic against real LDraw files (6-decimal authored coefficients,
 * compounded through nested submodel transforms) -- the same reasoning
 * applies here, and this rule shares the same measured tolerance.
 */
const AXIS_EPS = 1e-3;

function isMultiple(v: number, m: number): boolean {
  return Math.abs(v / m - Math.round(v / m)) < TOL;
}

const yAxis: Rule = {
  id: "E-02",
  needs: ["placements"],
  run({ model, meta }: RuleContext): Finding[] {
    const out: Finding[] = [];
    for (const p of model.placements) {
      // The Y-grid claim below is only meaningful in an axis-aligned frame
      // -- see isAxisAligned's doc comment. A placement reached through a
      // rotated ancestor submodel (an angled roof, a curved-track bogie, a
      // tilted assembly -- all ordinary in real released sets) can have a
      // world Y that is neither <= 0 nor a multiple of 4 while sitting
      // exactly on-grid in its own local frame. This tool cannot recover
      // that local frame from `world` alone, so it reports `unknown`
      // rather than asserting a violation it cannot actually see.
      if (!isAxisAligned(p.world, AXIS_EPS)) {
        out.push({
          ruleId: meta.id,
          tier: meta.tier,
          status: "unknown",
          message: `${p.partId} is reached through a non-axis-aligned transform; world-frame Y-grid alignment is not decidable here`,
          locations: [{ file: p.file, line: p.line, partId: p.partId }],
        });
        continue;
      }

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
