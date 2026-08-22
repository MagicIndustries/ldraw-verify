import { chmod, mkdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
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

  it("does not throw for a directory with no parts/p subdirectories (empty index, not a rejection)", async () => {
    // Renamed from "does not cache a failed scan as a permanent failure":
    // a missing root directory never actually rejects `scanDirectory` --
    // `readdir` is caught per-subdirectory inside the scan (see
    // `scanDirectory`'s `try { names = await readdir(dir); } catch {
    // continue; }`), so this path returns an empty index, not a rejected
    // promise. That is a real and useful guarantee (an unusual library
    // layout degrades to "nothing indexed" rather than throwing), but it is
    // NOT the eviction path `indexCache` exists for -- see the test below
    // for that.
    const missing = await LibraryIndex.fromDirectory("test/fixtures/does-not-exist");
    expect(missing.size).toBe(0);
    expect((await LibraryIndex.fromDirectory("test/fixtures/does-not-exist")).size).toBe(0);
  });

  it("evicts a rejected scan so the next call re-scans instead of replaying the failure", async () => {
    // A genuine rejection needs a `readFile` inside the per-directory loop
    // to fail -- the only unguarded fs call in `scanDirectory` (`readdir`
    // failures are all caught locally, see the test above). An unreadable
    // `.dat` file (chmod 000) does that reliably: `readdir` lists it, then
    // reading its first line throws EACCES, rejecting the whole scan.
    const dir = "test/fixtures/broken-scan";
    const partsDir = join(dir, "parts");
    const datPath = join(partsDir, "unreadable.dat");
    try {
      await mkdir(partsDir, { recursive: true });
      await writeFile(datPath, "0 Test Unreadable Part\n");
      await chmod(datPath, 0o000);
      LibraryIndex.clearCache();

      await expect(LibraryIndex.fromDirectory(dir)).rejects.toThrow();

      // If the rejection had been cached forever (the bug `indexCache`'s
      // eviction guards against), this second call would replay the same
      // stale rejection instead of re-scanning -- so fixing the permission
      // and observing a SUCCESSFUL second call is what actually exercises
      // the eviction path, not just the empty-index case above.
      await chmod(datPath, 0o644);
      const lib = await LibraryIndex.fromDirectory(dir);
      expect(lib.size).toBe(1);
      expect(lib.has("unreadable.dat")).toBe(true);
    } finally {
      await chmod(datPath, 0o644).catch(() => {});
      await rm(dir, { recursive: true, force: true });
      LibraryIndex.clearCache();
    }
  });
});
