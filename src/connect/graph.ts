import type { LibraryIndex } from "../library/index.js";
import type { Vec3 } from "../parse/ast.js";
import { applyDir, applyPoint } from "../resolve/matrix.js";
import type { ResolvedModel } from "../resolve/ir.js";
import { collectSnapMetas } from "./closure.js";
import { metasToHotspots, type Hotspot } from "./hotspots.js";
import type { ShadowLibrary } from "./shadow.js";

export interface Edge {
  a: number;
  b: number;
  kind: string;
  at: Vec3;
  /**
   * The connecting hotspot's `secs=` radius (LDU), when the underlying
   * SNAP_* meta carried one -- see `metasToHotspots` in hotspots.ts. Rules
   * that need to identify a specific physical connector by size (e.g. B-01
   * distinguishing a System stud from a Technic pin by its 6 LDU radius)
   * read this rather than re-deriving it from part geometry.
   */
  radius?: number;
  /**
   * The `caps=` value (e.g. "one", "none") off the *female* hotspot of this
   * pairing, when it carried one -- see `Hotspot.caps` in hotspots.ts for
   * what the value means. `hotspotsCompatible` guarantees exactly one side
   * of a pair is female (`x.gender === y.gender` is rejected), so this is
   * never ambiguous the way `radius` is: unlike radius, both a stud and an
   * ordinary blind socket use `caps=one`, so falling back between sides the
   * way `radius` does would hide a genuine through-hole's `caps=none`
   * behind whichever side happened to carry a value. Reading specifically
   * the female side is what lets B-01 tell an ordinary anti-stud tube
   * (blind, `caps=one`) apart from a real Technic through-hole (open both
   * ends, `caps=none`) at the same nominal radius -- see B-01's doc comment
   * in `src/rules/l5-legality.ts`.
   */
  femaleCaps?: string;
  /**
   * True when the *male* hotspot of this pairing carried `[slide=true]` --
   * see `Hotspot.slide` in hotspots.ts. Read from the male side
   * specifically, mirroring `femaleCaps`'s female-side read: a Technic
   * axle/pin (always `slide=true`) can report a stud-radius male `SNAP_CYL`
   * hotspot just like a genuine System stud does, and inserting an
   * axle/pin into a Technic hole is the intended, ordinary use of that
   * hole -- not the "System stud in a pinhole" violation B-01 names. See
   * its doc comment in `src/rules/l5-legality.ts`.
   */
  maleSlide?: boolean;
}

export interface ConnectionGraph {
  edges: Edge[];
  coverage: { withData: number; total: number; ratio: number };
  unknownPlacements: number[];
  components: number;
  /**
   * Placement indices (Placement.index, from resolve/ir.ts) whose collected
   * snap metas passed through at least one grid= expansion that
   * expandGridWithStatus (grid.ts) could not fully expand -- i.e. at least
   * one PlacedMeta reaching this placement had gridDegraded: true (see
   * closure.ts). These placements' hotspots, and therefore any edges
   * touching them, are known to be under-reported: the real part likely has
   * more grid cells (and so more hotspots) than were produced, because the
   * only signal for how many is a grid= form this tool doesn't understand.
   * The single fallback-offset hotspot the degraded expansion DID produce
   * is still included in `edges` like any other -- this field flags the gap
   * without dropping what was still detected, per this tool's central
   * principle that nothing detected may be silently discarded.
   *
   * Kept distinct from `unknownPlacements` (no shadow data reached at all,
   * anywhere in the closure): a degraded placement has real data, just
   * incomplete data, which is a different failure mode a caller needs to be
   * able to tell apart from "we know nothing about this part".
   */
  degradedGridPlacements: number[];
  /**
   * Placement indices (Placement.index) whose collected snap metas included
   * at least one PlacedMeta with `axisUnreliable: true` (see that field's
   * doc comment in closure.ts) -- i.e. at least one hotspot reaching this
   * placement was computed through a non-orthonormal composed transform,
   * most commonly a shared connector-hole primitive reused at a different
   * size via a scaled subfile reference deep in a part's own geometry
   * (confirmed directly against the real shadow library: 3713.dat,
   * "Technic Bush with Two Flanges", has no shadow file of its own and its
   * only reachable connecting meta arrives this way, with `determinant3 ==
   * 20`).
   *
   * Handled exactly like `degradedGridPlacements`, for the same reason: a
   * corrupted axis can only make `hotspotsCompatible`'s axis check reject a
   * pairing that should have matched, never fabricate one that shouldn't
   * have -- under-reporting can only make the graph look more fragmented
   * than reality, never less. So this can only ever cast doubt on a `fail`
   * verdict (B-06), never manufacture or hide one.
   */
  unreliableAxisPlacements: number[];
  /**
   * Placement indices whose *only* connecting hotspots are SNAP_CLP.
   *
   * SNAP_CLP (clip) metas genuinely carry no gender attribute in the real
   * shadow library (160/160 occurrences bar one stray exception), and a
   * clip's real physical pairing -- gripping a cylindrical bar -- is a
   * geometric relation this tool does not implement (see Finding 3 in
   * task-10-report.md: implementing it would mean shipping an unvalidated
   * geometric rule, which this tool's central principle rules out).
   * `hotspotsCompatible` therefore never pairs a SNAP_CLP hotspot with
   * anything, by design, not by data gap.
   *
   * A placement whose only physical link to the rest of the model is a
   * clip or hinge (a flag, a tool in a minifig's hand, a Technic hinge
   * chain) is therefore structurally unable to gain an edge here, and
   * would look identical to a genuinely disconnected part to a naive
   * "one component" check. This field names those placements explicitly
   * -- in the same spirit as `degradedGridPlacements` -- so a later
   * component rule can recognise "isolated because of an unmodelled clip"
   * and decline to fail the model for it, instead of silently reporting a
   * false disconnection.
   */
  clipOnlyPlacements: number[];
  /**
   * Placement indices (Placement.index) whose hotspots include exactly one
   * genuine System stud -- a `SNAP_CYL` hotspot at (approximately) the 6 LDU
   * stud radius. A grid-expanded 1x1 plate/tile is the canonical example:
   * grid expansion (grid.ts) resolves it to precisely one such hotspot, so
   * this set is derivable from connectivity data rather than needing a
   * hand-maintained "which parts are single-stud" list. B-05 (no fractional
   * rotation of single-stud parts) is the first consumer.
   *
   * Scoped to `SNAP_CYL` at stud radius specifically, not "any male
   * hotspot": `SNAP_FGR` (hinge fingers), `SNAP_SPH` (ball joints) and
   * `SNAP_GEN` (generic connectors, e.g. a wheel's rim-to-hub mount) are
   * male connectors too but rotate by design -- a hinge finger and a ball
   * joint have no 90-degree detent at all, so counting them here would
   * subject them to B-05's axis-alignment check for a constraint they were
   * never under. Even within `SNAP_CYL`, radius still matters: a part can
   * carry a single *non-stud* round male feature (e.g. `2412b.dat`, "Tile
   * 1 x 2 Grille with Groove", whose sole male `SNAP_CYL` is a 4 LDU
   * decorative peg, not a 6 LDU stud) that would otherwise be
   * misclassified as a single-stud part. See the Task 14 report for the
   * corpus evidence (both cases measured directly against the real shadow
   * library).
   */
  singleStudParts?: Set<number>;
}

/** Stud radius (LDU) a male `SNAP_CYL` hotspot must be near to count as a
 * genuine stud for `singleStudParts`, mirroring `STUD_RADIUS`/`RADIUS_TOL`
 * in `src/rules/l5-legality.ts`'s B-01 (same physical constant, same
 * shadow-library rounding tolerance on `secs=` values; duplicated rather
 * than imported to keep this connectivity-layer module independent of the
 * rules layer). */
const STUD_RADIUS = 6;
const STUD_RADIUS_TOL = 0.5;

/** World-space distance (LDU) within which two hotspots are considered coincident. */
const POS_TOL = 1.0;
/** Tolerance on 1 - |cos(angle)| between two hotspot axes to count as aligned (parallel or anti-parallel both pass). */
const AXIS_TOL = 0.1;

/**
 * SNAP_CLP hotspots are never eligible to pair with anything -- see
 * `ConnectionGraph.clipOnlyPlacements`. This is checked ahead of, and
 * independent of, the kind-equality check below: a clip shouldn't even
 * pair with another clip, since two clips don't grip each other and the
 * one real occurrence of an explicit `[gender=F]` on a SNAP_CLP in the
 * corpus (out of 160) is not something this tool treats as load-bearing.
 */
const UNPAIRABLE_KINDS = new Set(["SNAP_CLP"]);

function hotspotsCompatible(x: Hotspot, y: Hotspot): boolean {
  if (UNPAIRABLE_KINDS.has(x.kind) || UNPAIRABLE_KINDS.has(y.kind)) return false;
  // Two hotspots of different kinds (e.g. a SNAP_CYL and a coincident
  // SNAP_GEN) must not pair just because they happen to share a point and
  // opposite genders -- kind is part of what makes a connection real.
  if (x.kind !== y.kind) return false;
  if (x.gender === y.gender) return false;
  const d = Math.hypot(x.pos[0] - y.pos[0], x.pos[1] - y.pos[1], x.pos[2] - y.pos[2]);
  if (d > POS_TOL) return false;
  const dot = x.axis[0] * y.axis[0] + x.axis[1] * y.axis[1] + x.axis[2] * y.axis[2];
  return 1 - Math.abs(dot) <= AXIS_TOL;
}

/**
 * Brute-force O(a.length * b.length) pairing between two flat hotspot
 * lists. This is the right shape for small, already-gathered sets (as in
 * this module's own tests) but `buildGraph` below does NOT call it across
 * whole placements -- doing so would mean comparing every placement
 * against every other placement, and every hotspot against every hotspot
 * within those pairs, which is O(placements^2) and does not finish on a
 * corpus of real sets. See the spatial hash in `buildGraph` instead.
 */
export function pairHotspots(a: Hotspot[], b: Hotspot[]): Array<[Hotspot, Hotspot]> {
  const out: Array<[Hotspot, Hotspot]> = [];
  for (const x of a) {
    for (const y of b) {
      if (hotspotsCompatible(x, y)) out.push([x, y]);
    }
  }
  return out;
}

function countComponents(n: number, edges: Edge[]): number {
  const parent = Array.from({ length: n }, (_, i) => i);
  function find(i: number): number {
    const p = parent[i]!;
    if (p === i) return i;
    const root = find(p);
    parent[i] = root;
    return root;
  }
  for (const e of edges) {
    const ra = find(e.a);
    const rb = find(e.b);
    if (ra !== rb) parent[ra] = rb;
  }
  const roots = new Set<number>();
  for (let i = 0; i < n; i++) roots.add(find(i));
  return roots.size;
}

interface LocatedHotspot {
  hotspot: Hotspot;
  placementIndex: number;
}

/**
 * World-space edge length of one spatial-hash cell, used to bucket
 * hotspots so pairing only compares hotspots that could plausibly
 * coincide, instead of every hotspot against every other.
 *
 * Must be >= POS_TOL: with cell size B >= tol, any two points at most
 * `tol` apart along a given axis differ by at most one cell index on that
 * axis (a coordinate span of `tol` can cross at most one boundary of a
 * grid spaced B >= tol apart). So probing the full 3x3x3 neighbourhood of a
 * hotspot's own cell (see `buildGraph`) is guaranteed to find every other
 * hotspot within POS_TOL, no matter how the pair happens to fall relative
 * to a cell boundary -- pairing needs near-coincident positions regardless,
 * so bucketing changes performance, not results.
 */
const BUCKET_SIZE = POS_TOL;

function cellIndex(coord: number): number {
  return Math.floor(coord / BUCKET_SIZE);
}

function bucketKey(x: number, y: number, z: number): string {
  return `${cellIndex(x)},${cellIndex(y)},${cellIndex(z)}`;
}

const NEIGHBOUR_OFFSETS = [-1, 0, 1];

/**
 * Walk every placement's connection closure, turn it into world-space
 * hotspots, and pair them into a connection graph.
 *
 * Placements are compared via a spatial hash on quantised world position
 * (see BUCKET_SIZE) rather than the O(placements^2) x O(hotspots^2) naive
 * form of comparing every placement against every other and every hotspot
 * against every hotspot within those pairs -- that does not finish on a
 * corpus with sets that have thousands of parts.
 */
export async function buildGraph(
  model: ResolvedModel,
  lib: LibraryIndex,
  shadow: ShadowLibrary,
): Promise<ConnectionGraph> {
  const unknownPlacements: number[] = [];
  const degradedGridPlacements: number[] = [];
  const unreliableAxisPlacements: number[] = [];
  const clipOnlyPlacements: number[] = [];
  const singleStudParts = new Set<number>();
  const all: LocatedHotspot[] = [];

  for (const p of model.placements) {
    const { metas, hadData, degradedGridCount } = await collectSnapMetas(p.partId, lib, shadow);
    if (!hadData) unknownPlacements.push(p.index);
    if (degradedGridCount > 0) degradedGridPlacements.push(p.index);
    if (metas.some((m) => m.axisUnreliable)) unreliableAxisPlacements.push(p.index);

    const hotspots = metasToHotspots(metas);
    // A part whose sole connecting hotspot is a SNAP_CLP is not a stud at
    // all. SNAP_CLP metas carry no gender attribute in the real shadow
    // library, so `metasToHotspots` defaults them to "male" (see that
    // file's doc comment) -- which would otherwise make a bare-clip part
    // (e.g. 15210.dat, a roadsign clip-on with no stud, or 92220.dat, a
    // hooked claw with a clip) count as a single-stud part here and become
    // subject to B-05's axis-alignment check, even though a clip mount
    // legitimately rotates freely and isn't a stud. `UNPAIRABLE_KINDS`
    // already marks SNAP_CLP as never eligible to pair (hotspotsCompatible,
    // above); the single-stud count excludes it for the same reason.
    //
    // Scoped further to kind === "SNAP_CYL" at stud radius -- see
    // ConnectionGraph.singleStudParts for why "any male hotspot" over-counts
    // hinge fingers, ball joints, generic connectors, and even non-stud
    // round SNAP_CYL features (decorative pegs, wheel-rim mounts). Kind
    // "SNAP_CYL" already excludes SNAP_CLP (UNPAIRABLE_KINDS' only member),
    // so no separate check against that set is needed here.
    //
    // Also excludes `slide` -- the same signal B-01 uses (see its doc
    // comment in l5-legality.ts): every Technic axle/pin checked in the real
    // shadow library reports a stud-radius male SNAP_CYL hotspot too (e.g.
    // 3706.dat "Technic Axle 6"), but a round shaft seated in a round
    // Technic hole has no yaw detent at all -- there is nothing for it to be
    // "sub-detent" relative to. Confirmed against the real OMR corpus: axles
    // (3705/3706/4519/32062/32073/...) accounted for a large share of B-05's
    // remaining false positives after the kind/radius fix alone.
    const studHotspots = hotspots.filter(
      (h) =>
        h.gender === "male" &&
        h.kind === "SNAP_CYL" &&
        h.radius !== undefined &&
        Math.abs(h.radius - STUD_RADIUS) <= STUD_RADIUS_TOL &&
        !h.slide,
    );
    if (studHotspots.length === 1) singleStudParts.add(p.index);
    if (hotspots.length > 0 && hotspots.every((h) => UNPAIRABLE_KINDS.has(h.kind))) {
      clipOnlyPlacements.push(p.index);
    }

    for (const h of hotspots) {
      all.push({
        hotspot: { ...h, pos: applyPoint(p.world, h.pos), axis: applyDir(p.world, h.axis) },
        placementIndex: p.index,
      });
    }
  }

  const buckets = new Map<string, LocatedHotspot[]>();
  for (const loc of all) {
    const key = bucketKey(loc.hotspot.pos[0], loc.hotspot.pos[1], loc.hotspot.pos[2]);
    const bucket = buckets.get(key);
    if (bucket) bucket.push(loc);
    else buckets.set(key, [loc]);
  }

  const edges: Edge[] = [];
  for (const loc of all) {
    const cx = cellIndex(loc.hotspot.pos[0]);
    const cy = cellIndex(loc.hotspot.pos[1]);
    const cz = cellIndex(loc.hotspot.pos[2]);
    for (const dx of NEIGHBOUR_OFFSETS) {
      for (const dy of NEIGHBOUR_OFFSETS) {
        for (const dz of NEIGHBOUR_OFFSETS) {
          const bucket = buckets.get(`${cx + dx},${cy + dy},${cz + dz}`);
          if (!bucket) continue;
          for (const cand of bucket) {
            // Each unordered pair is reported exactly once, from the
            // lower-indexed placement's scan (see this function's doc
            // comment on BUCKET_SIZE for why every in-tolerance pair is
            // guaranteed to be found at all). This also excludes
            // same-placement hotspots: a part cannot connect to itself.
            if (cand.placementIndex <= loc.placementIndex) continue;
            if (!hotspotsCompatible(loc.hotspot, cand.hotspot)) continue;
            // Either side of a compatible pair may carry the `secs=` radius
            // (it's meta-level data, not guaranteed to be duplicated on
            // both the male and female hotspot of a pairing), so fall back
            // to the candidate's when the scanning hotspot didn't have one.
            const radius = loc.hotspot.radius ?? cand.hotspot.radius;
            // femaleCaps/maleSlide are each read from one specific side,
            // never falling back to the other -- see their doc comments on
            // Edge. hotspotsCompatible already rejected same-gender pairs,
            // so exactly one of these two is female and the other male.
            const femaleHotspot = loc.hotspot.gender === "female" ? loc.hotspot : cand.hotspot;
            const maleHotspot = loc.hotspot.gender === "male" ? loc.hotspot : cand.hotspot;
            edges.push({
              a: loc.placementIndex,
              b: cand.placementIndex,
              kind: loc.hotspot.kind,
              at: loc.hotspot.pos,
              ...(radius !== undefined ? { radius } : {}),
              ...(femaleHotspot.caps !== undefined ? { femaleCaps: femaleHotspot.caps } : {}),
              ...(maleHotspot.slide ? { maleSlide: true as const } : {}),
            });
          }
        }
      }
    }
  }

  const total = model.placements.length;
  const withData = total - unknownPlacements.length;

  return {
    edges,
    coverage: { withData, total, ratio: total === 0 ? 1 : withData / total },
    unknownPlacements,
    degradedGridPlacements,
    unreliableAxisPlacements,
    clipOnlyPlacements,
    components: countComponents(total, edges),
    singleStudParts,
  };
}
