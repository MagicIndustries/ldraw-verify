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

function vec3(nums: number[]): Vec3 {
  return [nums[0] ?? 0, nums[1] ?? 0, nums[2] ?? 0];
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

    const secs = numbers(meta.attrs.secs);
    const radius = secs.length >= 2 ? secs[secs.length - 2] : undefined;

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
      });
    }
  }

  return out;
}
