import { describe, expect, it } from "vitest";
import { LibraryIndex } from "../src/library/index.js";

describe("LibraryIndex", () => {
  it("indexes parts by lowercase filename", async () => {
    const lib = await LibraryIndex.fromDirectory("test/fixtures/lib");
    expect(lib.has("3001.dat")).toBe(true);
    expect(lib.has("3001.DAT")).toBe(true);
    expect(lib.get("3001.dat")!.description).toBe("Brick  2 x  4");
  });

  it("flags ~Moved to aliases and records the target", async () => {
    const lib = await LibraryIndex.fromDirectory("test/fixtures/lib");
    const p = lib.get("3040.dat")!;
    expect(p.isAlias).toBe(true);
    expect(p.movedTo).toBe("3040b");
  });

  it("flags any ~-prefixed description as hidden", async () => {
    const lib = await LibraryIndex.fromDirectory("test/fixtures/lib");
    expect(lib.get("3040.dat")!.isHidden).toBe(true);
    expect(lib.get("3001.dat")!.isHidden).toBe(false);
  });

  it("returns undefined for an unknown part", async () => {
    const lib = await LibraryIndex.fromDirectory("test/fixtures/lib");
    expect(lib.get("9999999.dat")).toBeUndefined();
  });

  it("has() agrees with get() on a path-prefixed id", async () => {
    // A reference token can carry a subdirectory prefix (e.g. a subfile
    // reference to a part under parts/s/), which get() resolves by
    // stripping everything up to the last path separator before the
    // lowercase lookup. has() must strip the same way, or it can report a
    // part as absent that get() would successfully resolve.
    const lib = await LibraryIndex.fromDirectory("test/fixtures/lib");
    expect(lib.has("s\\3001s01.dat")).toBe(true);
    expect(lib.has("s\\3001s01.dat")).toBe(lib.get("s\\3001s01.dat") !== undefined);
    expect(lib.get("s\\3001s01.dat")!.id).toBe("3001s01.dat");
  });

  // Indexing the real library reads the first line of ~26k .dat files
  // (~2.6s). Every verifyFile call used to pay that, so a run over N
  // models paid it N times -- the thing this tool exists to do -- and the
  // test suite paid it once per fixture, which is what pushed
  // recall.test.ts's E-03 case past vitest's default 5s timeout under
  // contention with the graph suites. The fix is the memo below, not a
  // longer timeout.
  it("returns the same shared index for the same directory instead of re-scanning", async () => {
    const first = await LibraryIndex.fromDirectory("test/fixtures/lib");
    const second = await LibraryIndex.fromDirectory("test/fixtures/lib");
    expect(second).toBe(first);
    // Same directory reached by a different spelling of the same path
    // resolves to the same entry -- the key is the absolute path.
    expect(await LibraryIndex.fromDirectory("./test/fixtures/lib")).toBe(first);
  });

  it("re-scans after clearCache, so a caller that changed a library on disk can force a fresh read", async () => {
    const first = await LibraryIndex.fromDirectory("test/fixtures/lib");
    LibraryIndex.clearCache();
    const afterClear = await LibraryIndex.fromDirectory("test/fixtures/lib");
    expect(afterClear).not.toBe(first);
    expect(afterClear.get("3001.dat")!.description).toBe(first.get("3001.dat")!.description);
  });

  it("does not cache a failed scan as a permanent failure", async () => {
    // A directory with no parts/p subdirectories yields an empty index
    // rather than throwing, so the observable contract here is simply that
    // repeated calls keep working; the eviction it guards (see
    // `indexCache`) is that a rejected scan must not be replayed forever.
    const missing = await LibraryIndex.fromDirectory("test/fixtures/does-not-exist");
    expect(missing.size).toBe(0);
    expect((await LibraryIndex.fromDirectory("test/fixtures/does-not-exist")).size).toBe(0);
  });
});
