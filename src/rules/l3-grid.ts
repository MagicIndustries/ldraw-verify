import { AXIS_ALIGNED_ENTRY_EPS, isAxisAligned, translationOf } from "../resolve/matrix.js";
import type { StudFootprint } from "../connect/graph.js";
import type { Finding, Rule, RuleContext } from "./types.js";

/**
 * The LEGO System's actual vertical/horizontal LDU lattice: the greatest
 * common divisor of the system's own dimensional constants, as listed in
 * the corpus's `meta.ldu` block -- stud_pitch 20, plate_height 8,
 * brick_height 24, stud_height 4, technic_hole_axis_depth 10. gcd = 2.
 *
 * E-02 and E-04 were written against 4 (the plate quantum) and 10 (the
 * half-stud quantum) respectively. Those are the quanta of ONE
 * construction -- an ordinary studs-up stack of plates and bricks -- not
 * of the system. Two first-party, entirely in-system constructions land
 * off them by definition:
 *
 * - A Technic hole's axis sits `technic_hole_axis_depth` = 10 LDU into
 *   the brick, and 10 is not a multiple of 4. EVERY correctly seated
 *   Technic pin or axle therefore has a Y that is 2 (mod 4). Measured over
 *   a 24-model OMR sample, 1381 of E-02's 1554 "not a multiple of 4"
 *   findings were exactly at that offset, led by 2780.dat (Technic Pin),
 *   43093.dat (Axle Pin) and 4274.dat (Pin 1/2) -- a claim that is false
 *   by construction for the whole Technic system, not a detection.
 * - SNOT turns plate thickness (8) and wall thickness (4) into HORIZONTAL
 *   offsets, so the X/Z residuals of real sets cluster on 2, 4, 6 and 8
 *   (measured: 1015 of E-04's 1197 residuals) -- the corpus's own I1
 *   identity (5 plates == 2 studs) is what makes that legal.
 *
 * Narrowing both claims to the lattice the system actually has keeps what
 * they can genuinely catch -- a coordinate that is fractional or on an odd
 * LDU (measured: 84 fractional and 122 half-of-half-stud residuals in the
 * same sample, plus E-02's 173 non-integer/odd Y values) -- and stops
 * asserting a violation about constructions LEGO itself ships. It is a
 * correction to what the rule claims, not a tolerance widened until a rate
 * fell: the number that changes it is 10, from the corpus's own meta
 * block, not the failure rate.
 *
 * VERIFICATION PASS: E-02 used to also reject any placement with y > 0
 * ("a model built from a ground plane at y=0 has y <= 0"). That is the
 * SAME class of error as the quantum correction above: "build up from a
 * ground plane at y=0" is a generator convention -- one particular way to
 * AUTHOR a model -- not a property every valid placement has. A model
 * whose origin is not at its own ground plane (a part hanging below a
 * hinge point; a submodel authored with its own local origin elsewhere) is
 * not invalid. Measured over the same 24-model OMR sample used above: the
 * y > 0 branch fired on 11 of 24 models and 173 placements -- essentially
 * the same footprint as the quantum branch this file already corrects for
 * the identical reason. Removed outright rather than narrowed: unlike the
 * quantum (which has a real in-system value, 2, to narrow to), there is no
 * world-frame threshold on y that is true of every valid placement, so
 * there is nothing left for a `y <= 0` clause to legitimately assert. See
 * E-02's corpus note for the correction record.
 */
const SYSTEM_LDU_QUANTUM = 2;

/**
 * Tolerance on the REMAINDER of a coordinate divided by its grid step --
 * a pure arithmetic residual in LDU, not a matrix entry and not an angle.
 * (Formerly the bare name `TOL`, in a file that also carried `AXIS_EPS`;
 * the two measure entirely unrelated quantities.) Stays tight: an on-grid
 * coordinate is authored as an exact integer multiple, so the only drift
 * to absorb here is IEEE division noise, not authoring imprecision --
 * ancestor-transform imprecision is handled by the decidability gate
 * below, not by loosening this.
 */
const GRID_RESIDUAL_EPS = 1e-6;

/**
 * The decidability gate shared by BOTH rules in this file: the entry
 * tolerance for "is this rotation a multiple of 90 degrees", defined once
 * in src/resolve/matrix.ts (`AXIS_ALIGNED_ENTRY_EPS`) and imported rather
 * than restated here. See that constant for why 1e-3 and not
 * `ORTHONORMALITY_EPS`'s 0.05.
 */

function isMultiple(v: number, m: number): boolean {
  return Math.abs(v / m - Math.round(v / m)) < GRID_RESIDUAL_EPS;
}

/**
 * Shared preamble for a world-frame grid claim.
 *
 * E-02 (Y on a 4 LDU multiple) and E-04 (X/Z on a 10 LDU multiple) are the
 * same kind of claim about the same kind of number, and neither is
 * decidable when the placement is reached through an ancestor transform
 * that is not a multiple of 90 degrees -- an angled roof section, a train
 * bogie on curved track, a tilted decorative assembly, all routine in real
 * released sets. Such a placement can sit exactly on-grid in its own
 * submodel's local frame while its composed world coordinates are a
 * multiple of nothing at all, and this tool cannot recover that local
 * frame from `world` alone.
 *
 * E-02 had this gate; E-04 asserted `fail` on exactly the placements E-02
 * declared undecidable (measured on 10001-1.mpd: E-02 emitted 555
 * `unknown` and 211 `fail`, E-04 emitted 590 `fail` and zero `unknown`) --
 * the clearest breach of this tool's three-valued model on the branch.
 * Extracting the gate into one helper is what stops it drifting apart
 * again: neither rule can now decide the question without answering it.
 */
function undecidableInWorldFrame(
  p: { partId: string; file: string; line: number; world: readonly number[] },
  meta: { id: string; tier: Finding["tier"] },
  claim: string,
): Finding | undefined {
  if (isAxisAligned(p.world, AXIS_ALIGNED_ENTRY_EPS)) return undefined;
  return {
    ruleId: meta.id,
    tier: meta.tier,
    status: "unknown",
    message: `${p.partId} is reached through a non-axis-aligned transform; world-frame ${claim} is not decidable here`,
    locations: [{ file: p.file, line: p.line, partId: p.partId }],
  };
}

const yAxis: Rule = {
  id: "E-02",
  needs: ["placements"],
  run({ model, meta }: RuleContext): Finding[] {
    const out: Finding[] = [];
    for (const p of model.placements) {
      // See `undecidableInWorldFrame`: the Y-grid claim below is only
      // meaningful in an axis-aligned frame.
      const undecidable = undecidableInWorldFrame(p, meta, "Y-grid alignment");
      if (undecidable) {
        out.push(undecidable);
        continue;
      }

      // No y <= 0 check here -- see the doc comment above the SYSTEM_LDU_QUANTUM
      // section header and this rule's corpus note (VERIFICATION PASS) for why
      // that clause was removed rather than corrected: "built up from a ground
      // plane at y=0" is one generator's authoring convention, not a property
      // every valid placement has, and real released sets measurably place
      // parts at y > 0 (e.g. hanging below a hinge point).
      const [, y] = translationOf(p.world);
      if (!isMultiple(y, SYSTEM_LDU_QUANTUM)) {
        out.push({
          ruleId: meta.id,
          tier: meta.tier,
          status: "fail",
          message: `y = ${y} is not a multiple of ${SYSTEM_LDU_QUANTUM} LDU (the System's own vertical lattice: gcd of plate 8, brick 24, stud 4 and Technic hole depth 10)`,
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
      // The same gate E-02 applies, for the same reason and via the same
      // helper. Without it this rule asserted `fail` on exactly the
      // placements E-02 declared undecidable -- an X/Z multiple-of-10
      // claim is no more recoverable from a composed world transform than
      // a Y multiple-of-4 claim is. See `undecidableInWorldFrame`.
      const undecidable = undecidableInWorldFrame(p, meta, "X/Z grid alignment");
      if (undecidable) {
        out.push(undecidable);
        continue;
      }

      const [x, , z] = translationOf(p.world);
      const bad = [
        ["x", x] as const,
        ["z", z] as const,
      ].filter(([, v]) => !isMultiple(v, SYSTEM_LDU_QUANTUM));
      if (bad.length === 0) continue;
      out.push({
        ruleId: meta.id,
        tier: meta.tier,
        status: "fail",
        message: `off-grid placement (${bad.map(([n, v]) => `${n}=${v}`).join(", ")}); in-system values are multiples of ${SYSTEM_LDU_QUANTUM} LDU (the System's own lattice: gcd of stud pitch 20, plate 8, brick 24, wall 4). Advisory — a DISCOURAGED finding is not a rejection`,
        locations: [{ file: p.file, line: p.line, partId: p.partId }],
        evidence: { x, z },
      });
    }
    return out;
  },
};

/** Half a stud pitch: studs sit this far inside a part's outline. */
const HALF_STUD_PITCH = 10;
/** Slack when deciding two brick edges abut, or two seams line up (LDU). */
const SEAM_EPS = 1;
/** A run needs at least this many bricks before it has an interior seam. */
const MIN_RUN = 2;
/**
 * Shortest part, along the run axis, that counts as masonry: two studs, i.e.
 * a 40 LDU outline. A single-stud part has no length to bond WITH -- a column
 * of 1x1 round plates is a column by design, not a wall built wrong -- and
 * admitting them was what made an earlier draft of this rule fire on 26% of
 * real sets, grouping round plates and slopes into imaginary courses.
 */
const MIN_MASONRY_SPAN = 40;
/**
 * Adjacent courses must be exactly one brick apart. A course sitting a plate
 * (8 LDU) above another is a different construction -- plates laid over a
 * brick course tie it together rather than continuing it -- and the bond
 * argument does not apply.
 */
const BRICK_COURSE_GAP = 24;

interface Brick {
  index: number;
  lo: number;
  hi: number;
  bandLo: number;
  bandHi: number;
}

/** Seam positions interior to a row of bricks that abut along one axis. */
function seamsOf(bricks: Brick[]): Map<number, [number, number]> {
  const seams = new Map<number, [number, number]>();
  const sorted = [...bricks].sort((a, b) => a.lo - b.lo);
  for (let i = 1; i < sorted.length; i++) {
    const prev = sorted[i - 1];
    const cur = sorted[i];
    if (!prev || !cur) continue;
    // Abutting, not overlapping and not separated. An overlap means the two
    // are not side by side in one course at all (different depths in a
    // two-deep wall, say), and a gap means there is no seam to repeat.
    if (Math.abs(cur.lo - prev.hi) > SEAM_EPS) continue;
    seams.set(Math.round(cur.lo), [cur.index, prev.index]);
  }
  return seams;
}

/**
 * B-07 / MASONRY_BOND.
 *
 * A wall built so that the joints between bricks line up from course to
 * course is a stack of independent columns: nothing ties one column to the
 * next, and the wall splits along the repeated joint. Offsetting each course
 * so its joints land over the middle of the bricks below is what makes courses
 * act as one piece -- the same reason real masonry uses a bond.
 *
 * Only the seam-repetition half of the corpus statement is checked here. The
 * other half, "min overlap 2 studs", is a separate measurement and is not
 * implemented; a model that satisfies this rule has not been checked for it.
 *
 * Scope is deliberately narrow, because the cost of guessing is a false
 * accusation on a legal build:
 *
 * - Only axis-aligned placements whose studs share one plane. Anything
 *   rotated, bracketed or SNOT is not a course and gets no verdict.
 * - Bricks are grouped into a run only when they sit at the same stud plane,
 *   share a band on the perpendicular axis, and physically abut. Bricks that
 *   merely happen to be collinear are not a wall.
 * - Two courses count as adjacent only when nothing lies between them and the
 *   gap is at most one brick.
 * - A seam must repeat over an overlapping band. Two seams at the same X in
 *   parts of the model 200 LDU apart in Z are not the same joint.
 *
 * Runs are found along X and along Z independently, so a wall in either
 * direction is covered, and a corner is simply two runs.
 */
const masonryBond: Rule = {
  id: "B-07",
  needs: ["graph", "placements"],
  run({ model, meta }: RuleContext): Finding[] {
    const footprints = model.graph?.studFootprints;
    if (!footprints) {
      return [
        {
          ruleId: meta.id,
          tier: meta.tier,
          status: "unknown",
          message: "no stud footprints were computed for this model; courses and seams are not decidable",
          locations: [],
        },
      ];
    }

    const out: Finding[] = [];
    // axis 0: runs along X, banded by Z. axis 1: runs along Z, banded by X.
    for (const axis of [0, 1] as const) {
      // course key -> bricks, where the key pins the stud plane AND the band,
      // so a two-deep wall's near and far leaves stay separate runs.
      const courses = new Map<string, Brick[]>();
      for (const [index, f] of footprints) {
        const p = model.placements[index];
        if (!p || !isAxisAligned(p.world, AXIS_ALIGNED_ENTRY_EPS)) continue;
        const b: Brick =
          axis === 0
            ? {
                index,
                lo: f.minX - HALF_STUD_PITCH,
                hi: f.maxX + HALF_STUD_PITCH,
                bandLo: f.minZ - HALF_STUD_PITCH,
                bandHi: f.maxZ + HALF_STUD_PITCH,
              }
            : {
                index,
                lo: f.minZ - HALF_STUD_PITCH,
                hi: f.maxZ + HALF_STUD_PITCH,
                bandLo: f.minX - HALF_STUD_PITCH,
                bandHi: f.maxX + HALF_STUD_PITCH,
              };
        if (f.count < 2 || b.hi - b.lo < MIN_MASONRY_SPAN) continue;
        const key = `${Math.round(f.y)}|${Math.round(b.bandLo)}|${Math.round(b.bandHi)}`;
        const list = courses.get(key);
        if (list) list.push(b);
        else courses.set(key, [b]);
      }

      // Group course keys by band, then walk each band's stud planes in
      // build order (LDraw's -Y is up, so descending Y is upward).
      const byBand = new Map<string, Array<{ y: number; bricks: Brick[] }>>();
      for (const [key, bricks] of courses) {
        if (bricks.length < MIN_RUN) continue;
        const [y, lo, hi] = key.split("|").map(Number);
        const band = `${lo}|${hi}`;
        const list = byBand.get(band);
        if (list) list.push({ y: y ?? 0, bricks });
        else byBand.set(band, [{ y: y ?? 0, bricks }]);
      }

      for (const levels of byBand.values()) {
        levels.sort((a, b) => a.y - b.y);
        for (let i = 1; i < levels.length; i++) {
          const upper = levels[i - 1];
          const lower = levels[i];
          if (!upper || !lower) continue;
          if (Math.abs(lower.y - upper.y - BRICK_COURSE_GAP) > SEAM_EPS) continue;
          const lowerSeams = seamsOf(lower.bricks);
          if (lowerSeams.size === 0) continue;
          const upperSeams = seamsOf(upper.bricks);
          for (const [x, pair] of lowerSeams) {
            let repeated: number | undefined;
            for (const ux of upperSeams.keys()) {
              if (Math.abs(ux - x) <= SEAM_EPS) {
                repeated = ux;
                break;
              }
            }
            if (repeated === undefined) continue;
            const locs = [...pair, ...(upperSeams.get(repeated) ?? [])]
              .map((idx) => model.placements[idx])
              .filter((pl): pl is NonNullable<typeof pl> => pl !== undefined)
              .map((pl) => ({ file: pl.file, line: pl.line, partId: pl.partId }));
            out.push({
              ruleId: meta.id,
              tier: meta.tier,
              status: "fail",
              message: `the vertical seam at ${axis === 0 ? "x" : "z"}=${x} repeats between adjacent courses; the courses are not bonded and the wall splits along the joint`,
              locations: locs,
              evidence: { axis: axis === 0 ? "x" : "z", seam: x, upperY: upper.y, lowerY: lower.y },
            });
          }
        }
      }
    }
    return out;
  },
};

export const l3Rules: Rule[] = [yAxis, xzGrid, masonryBond];
