import type { LibraryIndex } from "../library/index.js";
import type { Vec3 } from "../parse/ast.js";
import { applyDir, applyPoint } from "../resolve/matrix.js";
import type { ResolvedModel } from "../resolve/ir.js";
import { collectSnapMetas } from "./closure.js";
import {
  freeRotationAxes,
  metasToHotspots,
  rotationallySymmetricAxis,
  ROUND_SECTION,
  type Hotspot,
} from "./hotspots.js";
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
  /**
   * Placement indices of the endpoints that supplied the female and the male
   * hotspot of this pairing. `a`/`b` say which two parts met; these say which
   * of them was the socket and which was the plug.
   *
   * Without them `femaleCaps` and `maleSlide` are bare values whose owner is
   * unknowable downstream, so a rule can only ask "is either of these two
   * parts the kind of part I care about" -- which is a different question from
   * "is the part I care about the one that supplied the socket". B-01 got
   * exactly that wrong. A hollow-stud round brick stacked normally on a
   * Technic brick pairs the round brick's own hollow anti-stud (`caps=none`)
   * with the Technic brick's ordinary top stud; B-01 saw `caps=none`, saw that
   * one of the two parts was in its Technic-hole part list, and blamed a
   * pinhole ten LDU from the connection and not party to it. Over all 1,464
   * corpus models that produced 33 findings and zero genuine violations --
   * see `docs/rules-testing/B-01-CORPUS-SCAN.md`.
   */
  female: number;
  male: number;
  /**
   * The `secs=` radius as carried by each side specifically, with no
   * cross-side fallback. `radius` above answers "how big is this connection",
   * falling back to whichever side supplied a value; these answer "how big is
   * the plug" and "how big is the socket", which is a different question and
   * the one a rule identifying a *part type* by size actually needs.
   *
   * B-01 read `radius` to mean "the male is stud-sized" and that is not what
   * it says. In set 1682-1 a wheel rim (4266) meets a Technic brick: the rim's
   * only male connector is its r=38 tyre seat, but the fallback served the
   * female pinhole's 6 and B-01 called a 38 LDU rim a System stud.
   */
  maleRadius?: number;
  femaleRadius?: number;
}

/**
 * Rounding applied to a hotspot position before two edges are judged to be at
 * the same place. Pairing already ran to a 1 LDU tolerance, so two hotspot
 * pairs surviving within a whole LDU of each other describe one physical
 * mating, not two.
 */
const COINCIDENT_EDGE_ROUNDING = 1;

/**
 * Collapse the several edges a single physical connection can produce into one.
 *
 * A part's shadow data decomposes one connector into more than one `SNAP_*`
 * meta -- a Technic pin in a hole yields three coincident pairs, of which only
 * one carries `slide=true`. Emitting all three misrepresents one mating as
 * three connections and, worse, splits the evidence about what that mating IS
 * across them: a rule reading `maleSlide` off any single edge sees `undefined`
 * two times in three and concludes a seated pin is a System stud jammed into a
 * pinhole. Across a 25-model corpus sample 15.3% of all edges were coincident
 * duplicates, so this is the common case rather than an oddity.
 *
 * Edges are grouped by the pair they join, WHICH SIDE PLAYED WHICH ROLE, and
 * where they meet. Keying on roles as well as placements matters: a part can
 * offer both a male and a female hotspot at one point (3673.dat does), and
 * merging a pairing where A is the socket into one where A is the plug would
 * attribute `femaleCaps` to the wrong part -- the very confusion this data is
 * meant to resolve.
 *
 * Merged attributes take the union of the evidence rather than whichever edge
 * happened to come first:
 *
 * - `maleSlide` is true if ANY coincident male connector slides. A pin that
 *   slides does not stop sliding because the same pin also reports rigid end
 *   faces.
 * - `femaleCaps` prefers `"none"`. Two coincident sockets, one blind and one
 *   open, describe a hole something can pass through.
 *
 * Connector size is part of the key, not something merged. Two connectors of
 * different radii meeting the same part at the same point are two different
 * connectors and stay two edges. This is load-bearing rather than theoretical:
 * measured over the corpus, 495 groups keyed on role and position alone held
 * conflicting `maleRadius` values, so picking one -- by first-seen or any other
 * arbitrary rule -- would silently discard a real connector. Keying on the
 * radii instead makes the conflict impossible by construction, and costs almost
 * nothing: a Technic pin's three coincident metas all report r=6 and still
 * collapse to one edge.
 */
function mergeCoincidentEdges(edges: Edge[]): Edge[] {
  const groups = new Map<string, Edge>();
  for (const e of edges) {
    const at = e.at.map((v) => Math.round(v / COINCIDENT_EDGE_ROUNDING)).join(",");
    const key = `${e.female}|${e.male}|${e.kind}|${at}|${e.maleRadius ?? "-"}|${e.femaleRadius ?? "-"}`;
    const kept = groups.get(key);
    if (!kept) {
      groups.set(key, { ...e });
      continue;
    }
    if (e.maleSlide) kept.maleSlide = true;
    if (e.femaleCaps === "none") kept.femaleCaps = "none";
    // Radii are in the key, so every edge in a group already agrees on them.
    if (kept.radius === undefined && e.radius !== undefined) kept.radius = e.radius;
  }
  return [...groups.values()];
}

export interface ConnectionGraph {
  edges: Edge[];
  coverage: { withData: number; total: number; ratio: number };
  unknownPlacements: number[];
  components: number;
  /**
   * Component id per placement, indexed by `Placement.index`: two
   * placements are in the same connected component exactly when their
   * entries here are equal. The ids are union-find roots, so they are
   * placement indices, not a dense 0..components-1 range -- callers should
   * group by value, never assume a numbering.
   *
   * `components` alone (a count) is not enough for any rule that has to
   * say WHICH parts are floating, or reason about whether one particular
   * component's evidence is trustworthy. B-06 previously worked around
   * the absence of this by subtracting whole categories of placement from
   * the count (see its own "ConnectionGraph does not expose per-component
   * membership" note, now removed), which could only ever produce a
   * model-wide verdict from model-wide totals.
   */
  componentOf: number[];
  /**
   * Placements whose connectivity data is known to be incomplete, in any
   * of the ways this tool can detect:
   *
   * - no shadow data reached at all (`unknownPlacements`);
   * - data reached through an unexpandable `grid=` form
   *   (`degradedGridPlacements`);
   * - data composed through a non-orthonormal transform
   *   (`unreliableAxisPlacements`);
   * - at least one hotspot of an unpairable kind, i.e. SNAP_CLP, whose
   *   real physical pairing (a clip gripping a bar) this tool does not
   *   model at all -- a superset of `clipOnlyPlacements`, which only names
   *   placements where EVERY hotspot is a clip;
   * - zero hotspots despite having data: a part with no modelled connector
   *   may still be attached by a mechanism that isn't modelled, so its
   *   isolation is not evidence of anything;
   * - at least one `slide=true` hotspot: a Technic axle or pin mates
   *   anywhere ALONG its own axis, but `hotspotsCompatible` only pairs
   *   hotspots whose positions coincide within `POS_TOL`. An axle running
   *   through a beam's axle hole is a real connection this tool
   *   structurally cannot see whenever the two connectors' reference
   *   points sit at different points along the shaft. Found by measurement
   *   (final fix wave): B-06's only two `fail` verdicts over a 24-model
   *   OMR sample were both an axle-plus-bush pair -- 4519+32269 in
   *   41999-1.mpd, 3707+4265b in 5571-1.mpd -- that the graph showed as a
   *   sealed two-part island because the axle's other, real connection
   *   into the model's beams was invisible to a coincidence test. Both
   *   were false positives on a real released set.
   *
   * Every one of these can only ever HIDE a connection, never invent one.
   * That asymmetry is what makes the list usable: a missing edge can only
   * make the graph look more fragmented than reality. So an empty list
   * here means the component count is exact, and a non-empty one means a
   * component count above 1 might be an artifact of the gap.
   */
  incompleteDataPlacements: number[];
  /**
   * Placements whose connectivity is fully accounted for: they have shadow
   * data, that data is neither degraded nor axis-unreliable, they carry at
   * least one hotspot, none of their hotspots is of an unpairable kind,
   * and EVERY hotspot they carry already participates in at least one
   * edge. Exactly the complement of `incompleteDataPlacements` plus the
   * "no free connectors left" condition.
   *
   * The point of the last condition: a hidden connection has to land
   * somewhere. For a connection between this placement and something else
   * to have been missed, this placement would need a connector that is
   * currently unpaired (or unknown -- excluded by the conditions above).
   * If every connector it has is already spoken for, nothing can be
   * hiding. A component built entirely of such placements therefore cannot
   * be connected to anything outside itself -- which is what lets B-06
   * render a `fail` on a model that has data gaps ELSEWHERE, instead of
   * abstaining on the whole model because its coverage is not 100%.
   */
  fullyAccountedPlacements: number[];
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
  /**
   * Placement indices whose part has continuous rotational symmetry about
   * its own connection axis -- every connector round, coaxial and on that
   * one line. See `rotationallySymmetricAxis` (connect/hotspots.ts) for the
   * derivation and for why a square 1x1 plate does NOT qualify despite
   * having its connectors in the same places as a round one.
   *
   * Derived from the same hotspot data as `singleStudParts`, for the same
   * reason: which parts these are is a fact about the shadow library, not
   * something a hand-authored list should have to keep up with. B-05 uses
   * it to decide that a part is outside its scope entirely -- "which way is
   * it turned" is not a question that has an answer for a part like this,
   * so the rule makes no claim rather than a wrong one.
   */
  rotationallySymmetricParts?: Set<number>;
  /**
   * Placement index -> axes, in the PART'S OWN frame, about which a
   * connector the part carries permits free rotation (a hinge finger, a
   * ball joint, a round sliding shaft). See `freeRotationAxes`
   * (connect/hotspots.ts).
   *
   * Only placements with at least one such axis appear. The part frame,
   * not the world frame, is what a consumer needs: B-05 asks whether a
   * placement's own local rotation carries one of these axes to an
   * axis-aligned direction, which is exactly the condition for the
   * placement to be a legitimate setting of that joint.
   */
  freeRotationAxes?: Map<number, Vec3[]>;
}

/** Stud radius (LDU) a male `SNAP_CYL` hotspot must be near to count as a
 * genuine stud for `singleStudParts`, mirroring `STUD_RADIUS`/`STUD_RADIUS_TOL`
 * in `src/rules/l5-legality.ts`'s B-01 (same physical constant, same
 * shadow-library rounding tolerance on `secs=` values; duplicated rather
 * than imported to keep this connectivity-layer module independent of the
 * rules layer). */
const STUD_RADIUS = 6;
const STUD_RADIUS_TOL = 0.5;
/**
 * A System stud's height in LDU (`stud_height` in the corpus's own
 * `meta.ldu` block), matched against a hotspot's dominant `secs=` segment
 * depth. With the round-section requirement below, this is what separates
 * a genuine System stud (`R 6 4`, the profile `p/stud.dat` and `p/stud2.dat`
 * carry, and 111 further inline occurrences across the real shadow
 * library) from two other connector families that report the same 6 LDU
 * radius but have no yaw detent whatsoever:
 *
 * - Technic pin/axle ends: `A 6 20` (43093.dat "Technic Axle Pin with
 *   Friction"), `R 6 16` (6558.dat) -- a shaft in a round hole rotates
 *   continuously.
 * - Minifig limb pegs: `R 6 6.25` (3820.dat "Minifig Hand" wrist peg),
 *   and the shoulder pegs of 3818/3819 -- joints that rotate by design.
 *
 * Measured directly against the real OMR corpus, those two families
 * accounted for the largest share of B-05's remaining false positives:
 * 43093, 3820, 3818, 3819 and 6558 alone produced 161 of 402 B-05
 * findings in a 24-model sample, every one of them a part that CANNOT be
 * "sub-detent" because it has no detent. `slide=true` was the previous
 * discriminator and catches only some of them -- a friction pin is
 * explicitly meant NOT to slide freely, so it does not carry the flag.
 */
const STUD_HEIGHT = 4;
const STUD_HEIGHT_TOL = 0.5;

/** World-space distance (LDU) within which two hotspots are considered coincident. */
const POS_TOL = 1.0;
/**
 * Tolerance on `1 - |cos(angle)|` between two world-space hotspot axis
 * DIRECTIONS for the pair to count as aligned (parallel and anti-parallel
 * both pass).
 *
 * Named for the quantity it measures, because it is not one: it was
 * `AXIS_TOL`, a name simultaneously in use in src/rules/l5-legality.ts for
 * a rotation-MATRIX-ENTRY tolerance at 1e-6, and near-identical to
 * `AXIS_EPS` in src/rules/l3-grid.ts for the same entry quantity at 1e-3.
 * Three names, three meanings, no relationship between the values. The two
 * matrix-entry ones are now one shared constant
 * (`AXIS_ALIGNED_ENTRY_EPS`); this cosine tolerance is genuinely
 * different and deliberately stays local to the pairing code that is its
 * only consumer.
 */
const HOTSPOT_AXIS_COS_TOL = 0.1;

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
  return 1 - Math.abs(dot) <= HOTSPOT_AXIS_COS_TOL;
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

/**
 * Union-find over `edges`, returning both the component count and the
 * per-placement root (see `ConnectionGraph.componentOf`). One pass
 * produces both; they were never independent facts.
 */
function findComponents(n: number, edges: Edge[]): { count: number; componentOf: number[] } {
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
  const componentOf = new Array<number>(n);
  for (let i = 0; i < n; i++) {
    const root = find(i);
    componentOf[i] = root;
    roots.add(root);
  }
  return { count: roots.size, componentOf };
}

interface LocatedHotspot {
  hotspot: Hotspot;
  placementIndex: number;
  /** Position in `buildGraph`'s flat `all` list, so pairing can record
   * WHICH hotspots were consumed by an edge (see `pairedHotspots` there
   * and `ConnectionGraph.fullyAccountedPlacements`). */
  index: number;
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
  const rotationallySymmetricParts = new Set<number>();
  const freeRotation = new Map<number, Vec3[]>();
  const all: LocatedHotspot[] = [];
  /**
   * Per-placement bookkeeping for `incompleteDataPlacements` /
   * `fullyAccountedPlacements`, both of which need facts gathered in the
   * loop below (did data arrive, was it degraded/unreliable, how many
   * hotspots, any unpairable kind) combined with a fact only known after
   * pairing (was every hotspot consumed by an edge).
   */
  const perPlacement: Array<{
    index: number;
    complete: boolean;
    hotspotIndices: number[];
  }> = [];

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
        // A System stud's whole profile, not just its radius: round, 6 LDU
        // across, 4 LDU tall. See STUD_HEIGHT for the two families of
        // rotation-free connector this excludes, and why `slide` alone did
        // not catch them.
        h.sectionType === ROUND_SECTION &&
        h.sectionDepth !== undefined &&
        Math.abs(h.sectionDepth - STUD_HEIGHT) <= STUD_HEIGHT_TOL &&
        !h.slide,
    );
    if (studHotspots.length === 1) singleStudParts.add(p.index);

    // Both of these are properties of the PART, read off the hotspots
    // already in hand and in the part's own frame -- deliberately not
    // gated on `hadData`/`degradedGridCount`/`axisUnreliable`. Missing or
    // corrupted hotspot data can only break coaxiality or drop a
    // connector's section letter, and either one makes
    // `rotationallySymmetricAxis` return `undefined`; the failure mode is
    // "no exemption found", i.e. B-05 stays strict, never "exemption
    // fabricated from bad data".
    if (rotationallySymmetricAxis(hotspots)) rotationallySymmetricParts.add(p.index);
    const free = freeRotationAxes(hotspots);
    if (free.length > 0) freeRotation.set(p.index, free);

    if (hotspots.length > 0 && hotspots.every((h) => UNPAIRABLE_KINDS.has(h.kind))) {
      clipOnlyPlacements.push(p.index);
    }

    const hotspotIndices: number[] = [];
    for (const h of hotspots) {
      hotspotIndices.push(all.length);
      all.push({
        hotspot: { ...h, pos: applyPoint(p.world, h.pos), axis: applyDir(p.world, h.axis) },
        placementIndex: p.index,
        index: all.length,
      });
    }

    // "complete" here means only "nothing this tool can detect is missing
    // from this placement's hotspot set" -- see
    // `ConnectionGraph.incompleteDataPlacements` for each clause. Whether
    // those hotspots are all PAIRED is a separate question, answerable
    // only after the edge pass below.
    const hasUnpairableKind = hotspots.some((h) => UNPAIRABLE_KINDS.has(h.kind));
    // A `slide=true` connector mates anywhere along its axis; pairing only
    // sees coincident positions. See `incompleteDataPlacements`.
    const hasSlidingConnector = hotspots.some((h) => h.slide);
    const complete =
      hadData &&
      degradedGridCount === 0 &&
      !metas.some((m) => m.axisUnreliable) &&
      hotspots.length > 0 &&
      !hasUnpairableKind &&
      !hasSlidingConnector;
    perPlacement.push({ index: p.index, complete, hotspotIndices });
  }

  const buckets = new Map<string, LocatedHotspot[]>();
  for (const loc of all) {
    const key = bucketKey(loc.hotspot.pos[0], loc.hotspot.pos[1], loc.hotspot.pos[2]);
    const bucket = buckets.get(key);
    if (bucket) bucket.push(loc);
    else buckets.set(key, [loc]);
  }

  const edges: Edge[] = [];
  /** Indices into `all` of hotspots consumed by at least one edge. A
   * hotspot absent from this set is a free connector -- which is exactly
   * where an undetected connection could still be hiding. */
  const pairedHotspots = new Set<number>();
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
            const locIsFemale = loc.hotspot.gender === "female";
            const femaleHotspot = locIsFemale ? loc.hotspot : cand.hotspot;
            const maleHotspot = locIsFemale ? cand.hotspot : loc.hotspot;
            const female = locIsFemale ? loc.placementIndex : cand.placementIndex;
            const male = locIsFemale ? cand.placementIndex : loc.placementIndex;
            pairedHotspots.add(loc.index);
            pairedHotspots.add(cand.index);
            edges.push({
              a: loc.placementIndex,
              b: cand.placementIndex,
              female,
              male,
              kind: loc.hotspot.kind,
              at: loc.hotspot.pos,
              ...(radius !== undefined ? { radius } : {}),
              ...(maleHotspot.radius !== undefined ? { maleRadius: maleHotspot.radius } : {}),
              ...(femaleHotspot.radius !== undefined ? { femaleRadius: femaleHotspot.radius } : {}),
              ...(femaleHotspot.caps !== undefined ? { femaleCaps: femaleHotspot.caps } : {}),
              ...(maleHotspot.slide ? { maleSlide: true as const } : {}),
            });
          }
        }
      }
    }
  }

  const deduped = mergeCoincidentEdges(edges);
  edges.length = 0;
  edges.push(...deduped);

  const total = model.placements.length;
  const withData = total - unknownPlacements.length;

  const incompleteDataPlacements: number[] = [];
  const fullyAccountedPlacements: number[] = [];
  for (const entry of perPlacement) {
    if (!entry.complete) {
      incompleteDataPlacements.push(entry.index);
      continue;
    }
    if (entry.hotspotIndices.every((i) => pairedHotspots.has(i))) {
      fullyAccountedPlacements.push(entry.index);
    }
  }

  const { count, componentOf } = findComponents(total, edges);

  return {
    edges,
    coverage: { withData, total, ratio: total === 0 ? 1 : withData / total },
    unknownPlacements,
    degradedGridPlacements,
    unreliableAxisPlacements,
    clipOnlyPlacements,
    components: count,
    componentOf,
    incompleteDataPlacements,
    fullyAccountedPlacements,
    singleStudParts,
    rotationallySymmetricParts,
    freeRotationAxes: freeRotation,
  };
}
