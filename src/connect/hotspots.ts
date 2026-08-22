import type { Mat3, Vec3 } from "../parse/ast.js";
import { applyDir, applyPoint, fromLdraw } from "../resolve/matrix.js";
import { expandGrid } from "./grid.js";
import type { PlacedMeta } from "./closure.js";

export type Gender = "male" | "female";

export interface Hotspot {
  kind: string;
  gender: Gender;
  pos: Vec3;
  axis: Vec3;
  radius?: number;
  /**
   * The connector's `caps=` attribute, verbatim (e.g. "one", "none", "two"),
   * when the underlying SNAP_* meta carried one. This is the shadow
   * library's own signal for whether a cylindrical connector is a blind
   * socket (`caps=one`: closed at one end -- an ordinary stud or an
   * anti-stud tube, both of which use this) or a genuine through-hole
   * (`caps=none`: open at both ends -- a real Technic pinhole or axle hole,
   * e.g. `connhole.dat`/`beamhole.dat` in the real shadow library). Radius
   * alone cannot make that distinction: a Technic-hole-class part like
   * 3702.dat carries BOTH an ordinary `caps=one` anti-stud tube (for normal
   * top/bottom stacking) AND a `caps=none` through-hole (the actual
   * pinhole) at the same nominal 6 LDU radius, so B-01
   * (`src/rules/l5-legality.ts`) reads `caps` off the *female* side of an
   * edge to tell which one it actually connects to.
   */
  caps?: string;
  /**
   * True when the underlying meta carried `[slide=true]`. In the real
   * shadow library this marks a connector meant to slide/rotate along its
   * own axis inside whatever it mates with -- every Technic axle and pin
   * checked carries it (e.g. 3706.dat "Technic Axle 6", 6558.dat "Technic
   * Pin Long with Friction and Slot"), and so does the through-hole shape
   * itself (`connhole.dat`). A genuine System stud primitive (`p/stud.dat`,
   * `p/stud2.dat`, ...) never carries it. B-01
   * (`src/rules/l5-legality.ts`) uses this to tell a real System stud from
   * an axle/pin shaft that also happens to report a stud-radius `SNAP_CYL`
   * male hotspot -- an axle or pin seated in a Technic hole is the
   * intended, ordinary use of that hole, not the violation the rule names.
   */
  slide?: boolean;
  /**
   * Shape letter of the connector's dominant `secs=` segment, upper-cased
   * ("R", "A", "S", ...), when it carried a profile. See
   * `dominantSection`: a 6 LDU radius alone does not identify a System
   * stud, because a Technic axle end ("A") reports the same radius.
   */
  sectionType?: string;
  /**
   * Depth (LDU) of the connector's dominant `secs=` segment, when it
   * carried a profile -- i.e. how far the connector actually protrudes or
   * bores. A System stud is 4 (`stud_height` in the corpus's `meta.ldu`);
   * a minifig wrist peg at the same radius is 6.25 and a Technic axle end
   * is 20.
   */
  sectionDepth?: number;
}

/**
 * Re-exported so a caller of this module gets the full Task 10 hotspot
 * surface (`expandGrid` + `metasToHotspots`) from one place. The real
 * expansion logic lives in `grid.ts` (`expandGrid`/`expandGridWithStatus`,
 * written during Task 9 and already exercised by grid.test.ts against the
 * real shadow-library grid= syntax); redefining it here would risk two grid
 * implementations silently diverging.
 */
export { expandGrid } from "./grid.js";

/**
 * SNAP_* meta types that represent an actual physical connection point.
 * SNAP_INCL and SNAP_CLEAR are shadow-format plumbing, not connections
 * themselves: SNAP_INCL is resolved by recursing into the referenced part's
 * own closure (see closure.ts) and SNAP_CLEAR mutates the accumulated meta
 * list -- collectSnapMetas never pushes either type into its result, but the
 * filter is repeated here defensively since Hotspot extraction shouldn't
 * rely on that being the only place enforcing it.
 */
const CONNECTING = new Set(["SNAP_CYL", "SNAP_CLP", "SNAP_FGR", "SNAP_SPH", "SNAP_GEN"]);

const IDENTITY_ROT: Mat3 = [1, 0, 0, 0, 1, 0, 0, 0, 1];
/** LDCad's local "down the connector's axis" direction, before any [ori=]. */
const DOWN: Vec3 = [0, -1, 0];

function numbers(s: string | undefined): number[] {
  if (!s) return [];
  return s
    .split(/\s+/)
    .map(Number)
    .filter((n) => Number.isFinite(n));
}

/** One `secs=` cross-section segment: a type letter, a radius and a depth. */
interface Section {
  /** The segment's shape letter, upper-cased: "R" (round), "A" (axle
   * cross), "S" (square), "L_"/"_L" (chamfered mouths). A System stud is
   * always "R"; an axle shaft is "A", which is why the letter cannot be
   * discarded the way `numbers()` used to discard it. */
  type: string;
  radius: number;
  depth: number;
}

/**
 * Parse a `secs=` profile into its segments.
 *
 * `secs=` is a sequence of segments, each a type letter (R, S, A, _L, ...)
 * followed by exactly `(radius, depth)`, e.g. `S 6 4` is one segment and
 * `R 8 2   R 6 16   R 8 2` is three.
 */
function parseSections(secsAttr: string | undefined): Section[] {
  if (!secsAttr) return [];
  const tokens = secsAttr.trim().split(/\s+/).filter((t) => t.length > 0);
  const out: Section[] = [];
  for (let i = 0; i + 2 < tokens.length + 1; i++) {
    const type = tokens[i];
    if (type === undefined || Number.isFinite(Number(type))) continue;
    const radius = Number(tokens[i + 1]);
    const depth = Number(tokens[i + 2]);
    if (!Number.isFinite(radius) || !Number.isFinite(depth)) continue;
    out.push({ type: type.toUpperCase(), radius, depth });
    i += 2;
  }
  return out;
}

/**
 * The connector's functionally dominant cross-section: the segment with
 * the greatest depth.
 *
 * A single-segment profile (an ordinary stud or blind anti-stud tube) has
 * one unambiguous segment. A multi-segment profile is a real Technic
 * through-hole: e.g. `connhole.dat` in the real shadow library encodes
 * `R 8 2   R 6 16   R 8 2` -- a narrower R6 bore for the 16 LDU depth that
 * actually grips a stud, flared to R8 for 2 LDU at each open end
 * (chamfered mouths, not part of what a stud fits into). Taking the LAST
 * segment (the original logic here) picks an end-chamfer, not the bore --
 * for `connhole.dat` that reads radius 8, never matching the 6 LDU stud
 * radius B-01 (`src/rules/l5-legality.ts`) tests for, so a genuine
 * stud-in-pinhole edge could go undetected depending on which side of the
 * pairing happened to report `radius`. The greatest-depth segment is the
 * physically dominant section -- the actual shaft or bore -- which is
 * correct for both a single-segment profile (trivially, it is the only
 * segment) and a real multi-segment through-hole (the 16-deep bore
 * dominates the two 2-deep chamfers).
 *
 * Its TYPE and DEPTH matter as well as its radius, which is why this
 * returns the whole segment rather than just a number. A System stud is
 * exactly `R 6 4` (round, 6 LDU radius, 4 LDU tall -- `stud_radius` and
 * `stud_height` in the corpus's own `meta.ldu` block, and the profile
 * `p/stud.dat`/`p/stud2.dat` carry). Radius alone does not identify one:
 * a Technic axle end is `A 6 20` (43093.dat, "Technic Axle Pin with
 * Friction") and a minifig wrist peg is `R 6 6.25` (3820.dat) -- both
 * report a 6 LDU radius while being connectors that rotate freely by
 * design, with no 90-degree detent for B-05 to measure against. See
 * `ConnectionGraph.singleStudParts` in graph.ts.
 */
function dominantSection(secsAttr: string | undefined): Section | undefined {
  let best: Section | undefined;
  for (const section of parseSections(secsAttr)) {
    if (!best || section.depth > best.depth) best = section;
  }
  return best;
}

function vec3(nums: number[]): Vec3 {
  return [nums[0] ?? 0, nums[1] ?? 0, nums[2] ?? 0];
}

/**
 * `secs=` shape letter of a ROUND cross-section -- the one section shape
 * with continuous rotational symmetry about its own axis.
 *
 * The other shapes the real library uses are not symmetric and each carries
 * its own 90-degree detent: `S` (square) is the anti-stud cavity of a
 * rectangular plate/brick (3024.dat, a 1x1 plate, reports `S 6 4`; 3005.dat,
 * a 1x1 brick, `S 6 20`), and `A` is an axle cross (2819.dat's steering-wheel
 * axle hole, `A 6 14`). Both mate in exactly four orientations, so "which way
 * is it turned" remains a meaningful, 90-degree-quantised question for a part
 * carrying one -- see `rotationallySymmetricAxis`.
 *
 * Defined here, next to the `secs=` parser that produces the letter, and
 * imported by `connect/graph.ts` rather than re-declared there: the same
 * "is this section round" question asked in two places under two private
 * constants is the drift this branch already reconciled once for the
 * matrix tolerances.
 */
export const ROUND_SECTION = "R";

/**
 * Tolerance on `1 - |cos(angle)|` between two of ONE PART's own connector
 * axes, expressed in that part's own frame, for them to count as the same
 * axis.
 *
 * Deliberately tight, and deliberately not the same quantity as
 * `HOTSPOT_AXIS_COS_TOL` in connect/graph.ts: that one compares two
 * DIFFERENT parts' world-space axes across a placement pairing, where real
 * authored matrices contribute rounding, and so it runs at 0.1. This one
 * compares directions that are written literally in one shadow file's own
 * `pos=`/`ori=` attributes (or are the identity), where agreement is exact
 * and anything this tolerance has to absorb is float noise from composing
 * the part's own closure.
 */
const COAXIAL_COS_TOL = 1e-3;

/**
 * Maximum perpendicular distance (LDU) a connector may sit from the
 * candidate symmetry axis and still count as being ON it.
 *
 * A physical length, not a matrix tolerance. Shadow-library `pos=` values
 * for on-axis connectors are written as exact zeros, so this only has to
 * absorb float error from the closure walk's matrix composition; the
 * smallest genuinely off-axis connector offset in the real library is
 * whole LDU (30383.dat's two anti-studs sit +-10 LDU off centre), two
 * orders of magnitude clear of this.
 */
const COAXIAL_OFFSET_TOL = 0.1;

function norm(v: Vec3): number {
  return Math.hypot(v[0], v[1], v[2]);
}

function unit(v: Vec3): Vec3 | undefined {
  const n = norm(v);
  // A hotspot axis can arrive scaled rather than unit-length when it came
  // through a scaled subfile reference (see `unreliableAxisPlacements` in
  // connect/graph.ts, and 2819.dat, whose axle-hole axis reads `0 -12 0`).
  // Direction is all that is wanted here, so normalise; a genuinely zero
  // axis carries no direction at all and is reported as such.
  if (n < 1e-9) return undefined;
  return [v[0] / n, v[1] / n, v[2] / n];
}

function sameAxis(a: Vec3, b: Vec3): boolean {
  // Anti-parallel counts: a stud pointing up and an anti-stud pointing
  // down lie on one axis. This is a direction test, not an orientation one.
  return 1 - Math.abs(a[0] * b[0] + a[1] * b[1] + a[2] * b[2]) <= COAXIAL_COS_TOL;
}

/**
 * The axis about which this part's whole connection geometry is invariant,
 * or `undefined` if it has none.
 *
 * A part qualifies when every one of its connectors is (a) round in
 * cross-section, so it has no detent of its own, (b) aimed along one
 * common direction, and (c) positioned ON that one line. Turn such a part
 * about that line and every connector lands exactly where it already was:
 * there is no measurement, connectivity or otherwise, that distinguishes
 * the turned part from the untuned one. A round 1x1 plate (6141.dat: one
 * centred `R 6 4` stud, one centred `R 6 5` anti-stud, plus two centred
 * round bounding cylinders) is the canonical case; so are minifig heads
 * (3626*.dat), 1x1 cones and dishes (4740, 43898), plant stems (3742), and
 * a Technic pin (4274.dat, whose four connectors all sit on its own shaft
 * axis).
 *
 * The three conditions are each load-bearing, and (a) is what keeps this
 * from swallowing the rule it serves. A square 1x1 plate has exactly the
 * same connector POSITIONS as a round one -- one centred stud, one centred
 * anti-stud -- and is told apart only by its anti-stud's `S` section
 * (3024.dat `S 6 4` vs 6141.dat `R 6 5`). Dropping (a) would exempt every
 * 1x1 plate, tile and brick in the library, which is precisely the class
 * B-05 exists to catch. See `ROUND_SECTION` for the other non-round shape.
 *
 * The line does NOT have to pass through the part's origin. Rotating about
 * a line parallel to, but offset from, the origin differs from rotating
 * about the origin only by a translation, and the placement's own position
 * absorbs that: for any rotation R with R*d == A*d for some axis-aligned A,
 * the two placements (pos, R) and (pos + R*p0 - A*p0, A) put every hotspot
 * at exactly the same point. So "offset from the origin" never makes the
 * symmetry claim weaker.
 *
 * A part with no connectors at all is NOT symmetric here: nothing has been
 * established about it, and returning an axis would state a fact the data
 * does not support.
 */
export function rotationallySymmetricAxis(hotspots: Hotspot[]): Vec3 | undefined {
  if (hotspots.length === 0) return undefined;
  let axis: Vec3 | undefined;
  for (const h of hotspots) {
    if (h.sectionType !== ROUND_SECTION) return undefined;
    const a = unit(h.axis);
    if (!a) return undefined;
    if (!axis) axis = a;
    else if (!sameAxis(axis, a)) return undefined;
  }
  if (!axis) return undefined;
  const origin = hotspots[0]!.pos;
  for (const h of hotspots) {
    const d: Vec3 = [h.pos[0] - origin[0], h.pos[1] - origin[1], h.pos[2] - origin[2]];
    const along = d[0] * axis[0] + d[1] * axis[1] + d[2] * axis[2];
    const perp: Vec3 = [d[0] - along * axis[0], d[1] - along * axis[1], d[2] - along * axis[2]];
    if (norm(perp) > COAXIAL_OFFSET_TOL) return undefined;
  }
  return axis;
}

/**
 * The part's own axes about which a connector it carries permits FREE
 * rotation -- i.e. axes along which the part can legitimately be turned to
 * any angle at all, because a joint, not the stud grid, sets its angle.
 *
 * Three connector families qualify, all read off data the shadow library
 * already publishes rather than from a part list:
 *
 * - `SNAP_FGR`, a hinge finger. Rotation about the finger axis is the
 *   entire purpose of the connector; it has no detent (2433.dat, "Hinge Bar
 *   2 with 3 Fingers and Top Stud", and 30383.dat, a locking hinge plate).
 * - `SNAP_SPH`, a ball joint. A ball is free about every axis, so crediting
 *   only its own is a deliberate under-claim -- never an over-claim.
 * - `SNAP_CYL` with `[slide=true]` AND a round section: a round shaft in a
 *   round hole, or a bar in a clip. Earlier work established `slide=true`
 *   as "this connector mates anywhere ALONG its axis" (see `Hotspot.slide`
 *   and B-01); free rotation ABOUT that axis is the same physical fact
 *   seen from the other side, and LDCad's own wording for the flag is
 *   "slides/rotates along its axis inside its mate". The round-section
 *   requirement is what keeps a Technic AXLE out: an axle also carries
 *   `slide=true` (6587.dat, `A 6 58`) but an axle cross seats in exactly
 *   four orientations, so it slides freely while remaining detented in
 *   rotation.
 *
 * Presence on the part, not participation in an `Edge`, is what this
 * reports, and that is deliberate. Pairing cannot see these connections:
 * a `slide=true` connector mates anywhere along its axis while pairing
 * only matches coincident positions (the reason `incompleteDataPlacements`
 * exists at all), and measured against the real OMR corpus the hinge
 * fingers of both 2433.dat and 30383.dat produce no edge whatsoever in
 * models that unambiguously use them as hinges. Gating this on an edge
 * would therefore make the exemption depend on exactly the pairing this
 * tool documents as unreliable for exactly these connector kinds.
 */
export function freeRotationAxes(hotspots: Hotspot[]): Vec3[] {
  const out: Vec3[] = [];
  for (const h of hotspots) {
    const free =
      h.kind === "SNAP_FGR" ||
      h.kind === "SNAP_SPH" ||
      (h.kind === "SNAP_CYL" && h.slide === true && h.sectionType === ROUND_SECTION);
    if (!free) continue;
    const a = unit(h.axis);
    if (a) out.push(a);
  }
  return out;
}

/**
 * Turn a part's collected snap metas (already transformed into the part's
 * own root frame by `collectSnapMetas`) into concrete hotspots, expanding
 * any `grid=` attribute into one hotspot per cell.
 *
 * `grid=` on SNAP_CYL is the common case, not a rarity: it's how a single
 * meta represents e.g. all 8 underside tube holes of a 2x4 brick as one
 * line rather than eight. Every connecting meta type is expanded through
 * `expandGrid`, not just ones known to use it, so nothing is silently
 * dropped for a type that turns out to grid in some part.
 */
export function metasToHotspots(placed: PlacedMeta[]): Hotspot[] {
  const out: Hotspot[] = [];

  for (const { meta, xform } of placed) {
    if (!CONNECTING.has(meta.type)) continue;

    // SNAP_FGR carries gender under `genderOfs`, not `gender` (confirmed
    // against the real shadow library: 335 SNAP_FGR occurrences, all
    // `genderOfs=M`/`genderOfs=F` -- 227 M, 108 F -- none `gender=`).
    // `parseAttrs` lowercases attribute *names* but not values, so the key
    // to read is `genderofs` and the values stay the real "M"/"F" casing.
    // Every other connecting type here uses `gender` when it carries
    // gender data at all, so `gender` is tried first and `genderofs` is
    // the fallback -- this covers SNAP_FGR without changing behaviour for
    // SNAP_CYL/SNAP_SPH/SNAP_GEN. SNAP_CLP carries neither (see Finding 3
    // in task-10-report.md: it genuinely has no gender data in the real
    // library, so it keeps defaulting to "M" here -- `graph.ts`'s
    // kind-compatibility check means that default can never produce a
    // spurious pairing).
    const genderRaw = meta.attrs.gender ?? meta.attrs.genderofs ?? "M";
    const gender: Gender = genderRaw.toUpperCase().startsWith("F") ? "female" : "male";
    const base = vec3(numbers(meta.attrs.pos));

    const oriNums = numbers(meta.attrs.ori);
    const oriMat: Mat3 = oriNums.length === 9 ? (oriNums as unknown as Mat3) : IDENTITY_ROT;
    // The meta's own local frame: origin at `base`, rotated by `ori`. Both
    // the axis direction and the grid offset below are expressed in this
    // frame, so both must be carried through it -- following closure.ts's
    // SNAP_INCL handling, which composes pos/ori/grid-offset as one matrix
    // product (`multiply(xform, fromLdraw(pos, ori))`, then the offset
    // applied through THAT) rather than adding the offset to pos unrotated.
    // Grid offsets that skip this are silently wrong whenever the meta
    // carries a non-identity ori: measured at 16.8% of real grid= lines
    // (574/3421), concentrated in sideways-mounted connector banks.
    const localMat = fromLdraw(base, oriMat);
    const worldAxis = applyDir(xform, applyDir(localMat, DOWN));

    const section = dominantSection(meta.attrs.secs);
    const radius = section?.radius;
    const caps = meta.attrs.caps;
    const slide = meta.attrs.slide?.toLowerCase() === "true";

    for (const offset of expandGrid(meta.attrs)) {
      // offset is in the meta's own (pos, ori) frame -- applyPoint rotates
      // it by ori AND adds base, giving base + ori * offset, matching
      // closure.ts's precedent.
      const localPos = applyPoint(localMat, offset);
      out.push({
        kind: meta.type,
        gender,
        pos: applyPoint(xform, localPos),
        axis: worldAxis,
        ...(radius !== undefined ? { radius } : {}),
        ...(section !== undefined ? { sectionType: section.type, sectionDepth: section.depth } : {}),
        ...(caps !== undefined ? { caps } : {}),
        ...(slide ? { slide: true as const } : {}),
      });
    }
  }

  return out;
}
