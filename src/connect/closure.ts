import type { Mat3, Vec3 } from "../parse/ast.js";
import type { LibraryIndex } from "../library/index.js";
import { tokenizeLine } from "../parse/tokenize.js";
import { fromLdraw, IDENTITY4, isOrthonormal, multiply, type Mat4 } from "../resolve/matrix.js";
import { expandGridWithStatus } from "./grid.js";
import { parseSnapMetas, type ShadowLibrary, type SnapMeta } from "./shadow.js";

export interface PlacedMeta {
  meta: SnapMeta;
  xform: Mat4;
  /**
   * True when this meta was reached through a `SNAP_INCL [grid=...]` whose
   * grid attribute didn't fully expand (see `expandGridWithStatus` in
   * `grid.ts` — currently the undocumented three-axis form). The recursion
   * still ran once, at the single `[0,0,0]` fallback offset, so this meta
   * (and everything else pulled in alongside it) represents only one of
   * what should have been several tiled instances; siblings at the other
   * grid cells were never collected. Absent (not `false`) when the meta's
   * placement chain never passed through a degraded grid expansion.
   */
  gridDegraded?: boolean;
  /**
   * True when `xform` -- the transform this meta's `pos`/`ori`/hotspot axis
   * are composed through -- is not orthonormal at the point this meta was
   * collected. `xform` accumulates through two paths: SNAP_INCL's own
   * `pos`/`ori` (always a plain shadow-format rotation, orthonormal by
   * construction) and, separately, every real subfile line walked while
   * descending through a part's *own* geometry (`walk`'s `partText` loop
   * below). The second path can carry genuine non-uniform scale: LDraw part
   * authoring routinely reuses one shared connector-hole/bush-hole
   * primitive at different depths via a scaled subfile reference, which is
   * completely legitimate for *rendering* geometry but corrupts a hotspot's
   * `axis` direction once composed through it (`applyDir` in
   * `hotspots.ts`'s `metasToHotspots` is a plain linear map, not corrected
   * for non-uniform scale). A corrupted axis can only make
   * `hotspotsCompatible`'s axis check (graph.ts) *reject* a real pairing,
   * never fabricate one -- confirmed directly against the real shadow
   * library: 3713.dat ("Technic Bush with Two Flanges") has no shadow file
   * of its own, and its only reachable connecting meta arrives through a
   * subfile chain whose accumulated `xform` has `determinant3 == 20` and
   * fails `isOrthonormal` outright. See `ConnectionGraph.unreliableAxisPlacements`
   * in `graph.ts` for how this feeds B-06.
   */
  axisUnreliable?: boolean;
}

interface ClosureResult {
  metas: PlacedMeta[];
  hadData: boolean;
  /**
   * Count of `SNAP_INCL [grid=...]` attributes encountered in this closure
   * that `expandGridWithStatus` could not fully expand (see
   * `PlacedMeta.gridDegraded`). Zero means every grid attribute seen either
   * expanded cleanly or was absent. This is a count of degraded
   * *attributes*, not of dropped cells or affected metas — the tool has no
   * way to know how many cells a three-axis grid was meant to produce.
   */
  degradedGridCount: number;
}

/**
 * Tolerance for the axisUnreliable check. Reuses the same reasoning as
 * `ORTHONORMAL_EPS` in `src/rules/l2-matrix.ts`: real composed transforms
 * carry rounding drift from 6-decimal-place authoring, so this must be
 * loose enough not to flag ordinary rounding noise, while still catching a
 * genuine non-uniform scale (e.g. determinant 20, measured directly against
 * the real shadow library -- see `PlacedMeta.axisUnreliable`).
 */
const XFORM_EPS = 0.05;

const MAX_DEPTH = 32;
const IDENTITY_ROT: Mat3 = [1, 0, 0, 0, 1, 0, 0, 0, 1];

/**
 * Per-(shadow library, part library) memo of walkClosure results, keyed by
 * the part's canonical relative path (falling back to the raw id for
 * references the library doesn't know about).
 *
 * Scope/lifetime: nested WeakMaps keyed first on the ShadowLibrary instance
 * and then on the LibraryIndex instance. This ties the cache's lifetime to
 * the (lib, shadow) pair the caller constructed rather than to the process
 * or to a manually-managed "session" object: as long as a caller keeps using
 * the same lib/shadow instances (the normal case — one LibraryIndex and one
 * ShadowLibrary opened once per corpus run), every repeat placement of a
 * part is served from cache instead of re-walking and re-reading files. If a
 * caller opens a fresh LibraryIndex/ShadowLibrary (a new corpus run, or an
 * independent test), it gets a fresh, empty cache automatically — there is
 * no cross-run staleness and nothing to explicitly clear or dispose, since
 * WeakMap entries are collected once both keys are unreachable.
 */
const resultCache = new WeakMap<ShadowLibrary, WeakMap<LibraryIndex, Map<string, Promise<ClosureResult>>>>();

function cacheFor(lib: LibraryIndex, shadow: ShadowLibrary): Map<string, Promise<ClosureResult>> {
  let byLib = resultCache.get(shadow);
  if (!byLib) {
    byLib = new WeakMap<LibraryIndex, Map<string, Promise<ClosureResult>>>();
    resultCache.set(shadow, byLib);
  }
  let cache = byLib.get(lib);
  if (!cache) {
    cache = new Map<string, Promise<ClosureResult>>();
    byLib.set(lib, cache);
  }
  return cache;
}

function parseVec3(text: string | undefined): Vec3 | undefined {
  if (text === undefined) return undefined;
  const nums = text.trim().split(/\s+/).map(Number);
  if (nums.length !== 3 || nums.some((n) => !Number.isFinite(n))) return undefined;
  return [nums[0]!, nums[1]!, nums[2]!] as Vec3;
}

function parseMat3(text: string | undefined): Mat3 | undefined {
  if (text === undefined) return undefined;
  const nums = text.trim().split(/\s+/).map(Number);
  if (nums.length !== 9 || nums.some((n) => !Number.isFinite(n))) return undefined;
  return [nums[0]!, nums[1]!, nums[2]!, nums[3]!, nums[4]!, nums[5]!, nums[6]!, nums[7]!, nums[8]!] as Mat3;
}

/**
 * Walk a part's full reference closure, collecting SNAP_* metas from every
 * shadow file encountered and transforming each into the part's own frame.
 *
 * The recursion is mandatory: reading only a part's own shadow file yields
 * 15.3% coverage instead of 81.1%, and 3001.dat has no shadow file at all.
 *
 * SNAP_CLEAR drops accumulated info from the closure so far. Bare
 * `SNAP_CLEAR` resets everything; the id-scoped form, `SNAP_CLEAR
 * [ID=someId]`, removes only the previously-accumulated metas whose own
 * `id` attribute matches (case-insensitively — key casing is already
 * normalised by `parseAttrs`, and real files are consistent on value
 * casing, but the comparison is defensive regardless). This removes EVERY
 * accumulated meta with a matching id, not just one: if two independently
 * inherited metas ever shared an id, an id-scoped clear would remove both.
 * That's accepted as current behaviour rather than fixed — the shadow
 * format gives no further information to disambiguate same-id metas, and a
 * corpus check found all 11 distinct id tags in use are each defined by
 * exactly one primitive, so no real file currently exercises the
 * collision (pinned by a test in closure.test.ts regardless, so the choice
 * stays deliberate and visible rather than incidental).
 * SNAP_INCL pulls in another shadow file's data as if that file's part were
 * placed at `[pos]`/`[ori]` (defaulting to identity) relative to the current
 * frame — it is resolved by recursing into that referenced part's own
 * closure, exactly like a physical subfile placement, rather than being
 * reported as a snap point itself. An optional `[grid=...]` attribute tiles
 * that inclusion into a repeated array (see `expandGridWithStatus` in
 * `grid.ts`); each cell is a separate recursion at its own offset. When
 * that expansion is degraded (an unhandled grid form), see
 * `PlacedMeta.gridDegraded` and `ClosureResult.degradedGridCount`.
 */
export async function collectSnapMetas(
  partId: string,
  lib: LibraryIndex,
  shadow: ShadowLibrary,
): Promise<{ metas: PlacedMeta[]; hadData: boolean; degradedGridCount: number }> {
  const cache = cacheFor(lib, shadow);
  const entry = lib.get(partId);
  const key = (entry?.relPath ?? partId).toLowerCase();

  let pending = cache.get(key);
  if (!pending) {
    pending = walkClosure(partId, lib, shadow);
    // A rejection (e.g. a transient I/O error such as EMFILE under bulk
    // concurrent processing) must not poison this entry for the lifetime of
    // the (lib, shadow) pair: evict it so the next call retries the walk
    // instead of re-throwing the same stale rejection forever.
    pending.catch(() => {
      if (cache.get(key) === pending) cache.delete(key);
    });
    cache.set(key, pending);
  }

  const result = await pending;
  // Fresh array per call so a caller mutating the result can't corrupt the cache.
  return {
    metas: result.metas.map((m) => ({
      meta: m.meta,
      xform: m.xform,
      ...(m.gridDegraded ? { gridDegraded: true as const } : {}),
      ...(m.axisUnreliable ? { axisUnreliable: true as const } : {}),
    })),
    hadData: result.hadData,
    degradedGridCount: result.degradedGridCount,
  };
}

async function walkClosure(partId: string, lib: LibraryIndex, shadow: ShadowLibrary): Promise<ClosureResult> {
  const metas: PlacedMeta[] = [];
  let hadData = false;
  let degradedGridCount = 0;
  const visiting = new Set<string>();

  // `inDegradedGrid` is threaded through the walk rather than recovered
  // afterwards from array-length arithmetic. Tagging by index range
  // (`before`/`after metas.length`) assumed the shared `metas` array only
  // grows during a recursive call, but SNAP_CLEAR (bare or id-scoped)
  // mutates that same shared array and can shrink it below `before` or
  // splice out entries ahead of it, silently detaching the tag from the
  // metas that earned it. Tagging at the moment a meta is pushed is immune
  // to that: it doesn't matter how SNAP_CLEAR reorders or shrinks the array
  // afterwards, because the flag was already recorded on the object itself.
  async function walk(id: string, xform: Mat4, depth: number, inDegradedGrid: boolean): Promise<void> {
    if (depth > MAX_DEPTH) return;
    const entry = lib.get(id);
    if (!entry) return;

    const key = entry.relPath.toLowerCase();
    if (visiting.has(key)) return;
    visiting.add(key);

    const shadowText = await shadow.read(entry.relPath);
    if (shadowText !== undefined) {
      const found = parseSnapMetas(shadowText);
      if (found.length > 0) hadData = true;
      for (const meta of found) {
        if (meta.type === "SNAP_CLEAR") {
          const clearId = meta.attrs.id;
          if (clearId === undefined) {
            metas.length = 0;
          } else {
            const target = clearId.toLowerCase();
            for (let idx = metas.length - 1; idx >= 0; idx--) {
              if (metas[idx]!.meta.attrs.id?.toLowerCase() === target) metas.splice(idx, 1);
            }
          }
          continue;
        }
        if (meta.type === "SNAP_INCL") {
          const ref = meta.attrs.ref;
          if (ref !== undefined) {
            const pos = parseVec3(meta.attrs.pos) ?? [0, 0, 0];
            const ori = parseMat3(meta.attrs.ori) ?? IDENTITY_ROT;
            const base = multiply(xform, fromLdraw(pos, ori));
            const { offsets, degraded } = expandGridWithStatus(meta.attrs);
            if (degraded) degradedGridCount++;
            // Once inside a degraded expansion, everything pulled in
            // through it stays tagged even if a further-nested SNAP_INCL's
            // own grid= happens to expand cleanly — the outer recursion is
            // still only representing one of several tiled instances.
            const nextDegraded = inDegradedGrid || degraded;
            for (const offset of offsets) {
              await walk(ref, multiply(base, fromLdraw(offset, IDENTITY_ROT)), depth + 1, nextDegraded);
            }
          }
          continue;
        }
        metas.push({
          meta,
          xform,
          ...(inDegradedGrid ? { gridDegraded: true as const } : {}),
          ...(!isOrthonormal(xform, XFORM_EPS) ? { axisUnreliable: true as const } : {}),
        });
      }
    }

    const partText = await lib.readText(id);
    for (const [i, raw] of partText.split(/\r?\n/).entries()) {
      const token = tokenizeLine(raw, i + 1);
      if (token.kind !== "subfile") continue;
      await walk(token.name, multiply(xform, fromLdraw(token.pos, token.mat)), depth + 1, inDegradedGrid);
    }

    visiting.delete(key);
  }

  await walk(partId, IDENTITY4, 0, false);
  return { metas, hadData, degradedGridCount };
}
