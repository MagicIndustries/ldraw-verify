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
}

/** World-space distance (LDU) within which two hotspots are considered coincident. */
const POS_TOL = 1.0;
/** Tolerance on 1 - |cos(angle)| between two hotspot axes to count as aligned (parallel or anti-parallel both pass). */
const AXIS_TOL = 0.1;

function hotspotsCompatible(x: Hotspot, y: Hotspot): boolean {
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
  const all: LocatedHotspot[] = [];

  for (const p of model.placements) {
    const { metas, hadData, degradedGridCount } = await collectSnapMetas(p.partId, lib, shadow);
    if (!hadData) unknownPlacements.push(p.index);
    if (degradedGridCount > 0) degradedGridPlacements.push(p.index);

    for (const h of metasToHotspots(metas)) {
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
            edges.push({
              a: loc.placementIndex,
              b: cand.placementIndex,
              kind: loc.hotspot.kind,
              at: loc.hotspot.pos,
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
    components: countComponents(total, edges),
  };
}
