import type { Mat3, Vec3 } from "../parse/ast.js";
import type { LibraryIndex } from "../library/index.js";
import { tokenizeLine } from "../parse/tokenize.js";
import { fromLdraw, IDENTITY4, multiply, type Mat4 } from "../resolve/matrix.js";
import { parseSnapMetas, type ShadowLibrary, type SnapMeta } from "./shadow.js";

export interface PlacedMeta {
  meta: SnapMeta;
  xform: Mat4;
}

interface ClosureResult {
  metas: PlacedMeta[];
  hadData: boolean;
}

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
 * SNAP_CLEAR drops everything accumulated so far in the closure (LDCad also
 * supports clearing a single id-tagged snap; this walk only implements the
 * full-reset form, the one actually used to drop inherited info wholesale).
 * SNAP_INCL pulls in another shadow file's data as if that file's part were
 * placed at `[pos]`/`[ori]` (defaulting to identity) relative to the current
 * frame — it is resolved by recursing into that referenced part's own
 * closure, exactly like a physical subfile placement, rather than being
 * reported as a snap point itself.
 */
export async function collectSnapMetas(
  partId: string,
  lib: LibraryIndex,
  shadow: ShadowLibrary,
): Promise<{ metas: PlacedMeta[]; hadData: boolean }> {
  const cache = cacheFor(lib, shadow);
  const entry = lib.get(partId);
  const key = (entry?.relPath ?? partId).toLowerCase();

  let pending = cache.get(key);
  if (!pending) {
    pending = walkClosure(partId, lib, shadow);
    cache.set(key, pending);
  }

  const result = await pending;
  // Fresh array per call so a caller mutating the result can't corrupt the cache.
  return { metas: result.metas.map((m) => ({ meta: m.meta, xform: m.xform })), hadData: result.hadData };
}

async function walkClosure(partId: string, lib: LibraryIndex, shadow: ShadowLibrary): Promise<ClosureResult> {
  const metas: PlacedMeta[] = [];
  let hadData = false;
  const visiting = new Set<string>();

  async function walk(id: string, xform: Mat4, depth: number): Promise<void> {
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
          metas.length = 0;
          continue;
        }
        if (meta.type === "SNAP_INCL") {
          const ref = meta.attrs.ref;
          if (ref !== undefined) {
            const pos = parseVec3(meta.attrs.pos) ?? [0, 0, 0];
            const ori = parseMat3(meta.attrs.ori) ?? IDENTITY_ROT;
            await walk(ref, multiply(xform, fromLdraw(pos, ori)), depth + 1);
          }
          continue;
        }
        metas.push({ meta, xform });
      }
    }

    const partText = await lib.readText(id);
    for (const [i, raw] of partText.split(/\r?\n/).entries()) {
      const token = tokenizeLine(raw, i + 1);
      if (token.kind !== "subfile") continue;
      await walk(token.name, multiply(xform, fromLdraw(token.pos, token.mat)), depth + 1);
    }

    visiting.delete(key);
  }

  await walk(partId, IDENTITY4, 0);
  return { metas, hadData };
}
