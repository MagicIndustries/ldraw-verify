import { readdir, readFile } from "node:fs/promises";
import { join, resolve } from "node:path";

export interface LibraryPart {
  id: string;
  description: string;
  isAlias: boolean;
  isHidden: boolean;
  /**
   * True when this file was indexed from a primitive directory (`p/`,
   * `p/48/`, `p/8/`) or the subpart directory (`parts/s/`) rather than the
   * ordinary placeable-part directory (`parts/`). Primitives (unit
   * cylinders, disks, edges, boxes, ...) exist to be scaled and composed
   * *inside* another part's own geometry -- that is how LDraw part
   * authoring works, and a part legitimately applies wild non-uniform scale
   * to a primitive to build its shape. Subparts (`parts/s/`, conventionally
   * referenced as `s\name.dat` or `s/name.dat`) are the same idea scoped to
   * one specific parent part instead of shared generically: per the LDraw
   * spec they exist solely to be included from a parent part's own .dat
   * file, never placed directly in a model.
   *
   * `parts/s/` was originally classified as "placeable" alongside `parts/`
   * until the Task 14 precision harness measured real OMR sets referencing
   * an `s\...` subpart directly from a `0 FILE` block that is itself a
   * custom/decorated embedded part (see `resolveModel`'s doc comment for
   * the general shape of that pattern) -- e.g. `10001-1.mpd`'s own
   * `164565e.dat` block referencing `s\4865p01b.dat` with a matrix whose
   * row-norm deviates from 1 by up to 0.8, which is not rounding drift, it
   * is a subpart legitimately stretched to build that one custom part's
   * shape. That is exactly the "building block for one custom part, not a
   * model placement" situation primitives are already excluded for, so
   * subparts get the same treatment.
   *
   * Neither a primitive nor a subpart is ever a placement in a *model*'s
   * own build, so `resolveModel` uses this flag to keep both kinds of
   * reference out of `ResolvedModel.placements`. See its doc comment for
   * how this surfaces in practice (an OMR set's own MPD embedding a
   * custom/decorated part as one of its `0 FILE` blocks).
   */
  isPrimitive: boolean;
  movedTo?: string;
  path: string;
  relPath: string;
}

const MOVED_TO = /^~Moved to\s+(\S+)/i;
const PRIMITIVE_DIRS = new Set(["p", "p/48", "p/8", "parts/s"]);

/**
 * Process-wide memo of `fromDirectory` results, keyed by the absolute
 * resolved root path.
 *
 * Indexing the real library means reading the first line of ~26k `.dat`
 * files; measured at ~2.6s per call on a warm filesystem cache. Every
 * `verifyFile` call built its own index, so the cost was paid once per
 * MODEL: the whole point of this tool is to be run across thousands of
 * models (`scripts/omr-precision.ts` does exactly that, and its own doc
 * comment already names this re-index as what dominates a per-model
 * timing), and the test suite pays it once per `verifyFile` in every
 * fixture case. That is not a test-runner budget problem to paper over
 * with a longer timeout -- re-reading an immutable, versioned artifact
 * once per model is the defect.
 *
 * Safe to share: `LibraryIndex` is immutable after construction (a private
 * `readonly` Map, no mutators, and `readText` re-reads from disk rather
 * than serving cached text), so two callers holding the same instance
 * cannot affect each other. The value cached is the in-flight Promise, not
 * the resolved index, so N concurrent callers (vitest running several test
 * files at once) share ONE directory scan instead of racing N of them.
 *
 * Keyed on `resolve(root)` so `".cache/ldraw"` and an absolute path to the
 * same directory share an entry. The LDraw library is a versioned artifact
 * that does not change under a running process; a caller that does change
 * it on disk (or a test that rebuilds a fixture library at a path it
 * already used) must call `clearCache` to be sure of a fresh read.
 */
const indexCache = new Map<string, Promise<LibraryIndex>>();

export class LibraryIndex {
  private constructor(private readonly parts: Map<string, LibraryPart>) {}

  /**
   * Returns the shared index for `root`, scanning the directory only on the
   * first call for that path. See `indexCache` for why this is safe and why
   * it is not merely an optimisation.
   */
  static async fromDirectory(root: string): Promise<LibraryIndex> {
    const key = resolve(root);
    let pending = indexCache.get(key);
    if (!pending) {
      pending = LibraryIndex.scanDirectory(root);
      // A rejected scan (transient I/O error, a root that doesn't exist
      // yet) must not be cached as a permanent failure for the life of the
      // process: evict it so the next caller retries the scan rather than
      // re-throwing a stale rejection. Mirrors the same eviction in
      // `collectSnapMetas`'s closure memo (src/connect/closure.ts).
      pending.catch(() => {
        if (indexCache.get(key) === pending) indexCache.delete(key);
      });
      indexCache.set(key, pending);
    }
    return pending;
  }

  /** Drops every memoised index. For tests (or a caller that knowingly
   * mutated a library directory in place) that need the next
   * `fromDirectory` call to re-read from disk. */
  static clearCache(): void {
    indexCache.clear();
  }

  private static async scanDirectory(root: string): Promise<LibraryIndex> {
    const parts = new Map<string, LibraryPart>();
    for (const sub of ["parts", "p", "parts/s", "p/48", "p/8"]) {
      const dir = join(root, sub);
      let names: string[];
      try {
        names = await readdir(dir);
      } catch {
        continue;
      }
      for (const name of names) {
        if (!name.toLowerCase().endsWith(".dat")) continue;
        const path = join(dir, name);
        const head = (await readFile(path, "utf8")).split(/\r?\n/, 1)[0] ?? "";
        const description = head.replace(/^0\s*/, "").trim();
        const moved = MOVED_TO.exec(description);
        const movedTo = moved?.[1];
        const key = name.toLowerCase();
        if (parts.has(key)) continue; // earlier directories win
        parts.set(key, {
          id: name,
          description,
          isAlias: moved !== null,
          isHidden: description.startsWith("~"),
          isPrimitive: PRIMITIVE_DIRS.has(sub),
          path,
          relPath: `${sub}/${name}`,
          ...(movedTo !== undefined ? { movedTo } : {}),
        });
      }
    }
    return new LibraryIndex(parts);
  }

  get(id: string): LibraryPart | undefined {
    const bare = id.replace(/\\/g, "/").split("/").pop() ?? id;
    return this.parts.get(bare.toLowerCase());
  }

  has(id: string): boolean {
    const bare = id.replace(/\\/g, "/").split("/").pop() ?? id;
    return this.parts.has(bare.toLowerCase());
  }

  async readText(id: string): Promise<string> {
    const p = this.get(id);
    if (!p) throw new Error(`part not in library: ${id}`);
    return readFile(p.path, "utf8");
  }

  get size(): number {
    return this.parts.size;
  }

  /**
   * Every indexed part, including primitives, subparts, aliases and hidden
   * files -- callers that want only placeable parts filter on `isPrimitive`,
   * `isAlias` and `isHidden`. Exposed for tools that derive data ACROSS the
   * library (see scripts/build-part-properties.ts) rather than resolving one
   * part at a time; the verifier itself only ever looks parts up by id.
   */
  all(): Iterable<LibraryPart> {
    return this.parts.values();
  }
}
