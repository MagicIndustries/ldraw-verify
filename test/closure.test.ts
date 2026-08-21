import { describe, expect, it, vi } from "vitest";
import { collectSnapMetas } from "../src/connect/closure.js";
import type { ShadowLibrary } from "../src/connect/shadow.js";
import { LibraryIndex } from "../src/library/index.js";
import { translationOf } from "../src/resolve/matrix.js";

// The physical part library (subfile placements) has to be real files on disk
// because LibraryIndex.fromDirectory reads a real directory and LibraryIndex
// itself has private fields, so it can't be faked structurally. Shadow-meta
// content, by contrast, is supplied entirely in-memory below — the
// ShadowLibrary interface has no private members, so a plain object is a
// legitimate implementation and keeps these tests fast and hermetic.
const lib = await LibraryIndex.fromDirectory("test/fixtures/closure");

function fakeShadow(entries: Record<string, string>): ShadowLibrary {
  const map = new Map(Object.entries(entries).map(([k, v]) => [k.toLowerCase(), v]));
  return {
    async read(relPath: string): Promise<string | undefined> {
      return map.get(relPath.toLowerCase());
    },
  };
}

describe("collectSnapMetas", () => {
  it("inherits metas from a referenced sub-part, not just the part's own shadow file", async () => {
    // top.dat -> mid.dat -> leaf.dat; only leaf.dat has shadow data.
    const shadow = fakeShadow({
      "parts/leaf.dat": "0 !LDCAD SNAP_CYL [gender=M] [pos=0 0 0]",
    });
    const { metas, hadData } = await collectSnapMetas("top.dat", lib, shadow);
    expect(hadData).toBe(true);
    expect(metas).toHaveLength(1);
    expect(metas[0]!.meta.type).toBe("SNAP_CYL");
  });

  it("composes transforms correctly through two levels of nesting", async () => {
    // top->mid uses a 90deg rotation about Z + translate (10,0,0);
    // mid->leaf uses a 90deg rotation about X + translate (0,5,0).
    // Correct parent-then-child composition puts leaf's frame origin at
    // (5,0,0) in top's frame; a reversed multiply order gives (10,5,0).
    const shadow = fakeShadow({
      "parts/leaf.dat": "0 !LDCAD SNAP_CYL [gender=M] [pos=0 0 0]",
    });
    const { metas } = await collectSnapMetas("top.dat", lib, shadow);
    expect(metas).toHaveLength(1);
    expect(translationOf(metas[0]!.xform).map((n) => Math.round(n * 1e6) / 1e6)).toEqual([5, 0, 0]);
  });

  it("the visiting-set guard stops a reference cycle from duplicating a part's own metas", async () => {
    // selfref.dat includes itself directly AND carries its own shadow data.
    // This is deliberately NOT just "does it hang" (it wouldn't, either
    // way — MAX_DEPTH bounds the recursion regardless of the visiting-set
    // guard). It's a property only the `visiting` set can provide: with the
    // guard, walk(selfref) visits selfref once, collects its one meta, then
    // immediately bails out of the re-entrant call. Without the guard (but
    // with MAX_DEPTH still in place), the depth check alone would let the
    // recursion re-enter selfref.dat at every depth from 0 through
    // MAX_DEPTH (32) inclusive — 33 visits, each re-reading and re-pushing
    // the same shadow meta — ballooning the result to 33 duplicated metas
    // instead of 1. Asserting the exact count (not just "non-empty" or
    // "bounded") is what makes this test fail if the guard is removed.
    const shadow = fakeShadow({
      "parts/selfref.dat": "0 !LDCAD SNAP_CYL [gender=M] [pos=0 0 0]",
    });
    const { metas, hadData } = await collectSnapMetas("selfref.dat", lib, shadow);
    expect(hadData).toBe(true);
    expect(metas).toHaveLength(1);
  });

  it("bounds runaway recursion with the depth guard, independent of the cycle guard", async () => {
    // chain0.dat -> chain1.dat -> ... -> chain40.dat, no cycle -- so the
    // visiting-set guard never triggers here (no id repeats) and this test
    // exercises MAX_DEPTH alone. Only chain40.dat carries shadow data, well
    // past MAX_DEPTH (32), so it must never be reached if the guard is
    // doing its job.
    const shadow = fakeShadow({
      "parts/chain40.dat": "0 !LDCAD SNAP_CYL [gender=M] [pos=0 0 0]",
    });
    const { metas, hadData } = await collectSnapMetas("chain0.dat", lib, shadow);
    expect(hadData).toBe(false);
    expect(metas).toEqual([]);
  });

  it("bare SNAP_CLEAR resets everything accumulated so far", async () => {
    // clearbare_parent -> clearbare_b (contributes a meta) -> clearbare_c
    // (bare SNAP_CLEAR).
    const shadow = fakeShadow({
      "parts/clearbare_b.dat": "0 !LDCAD SNAP_CYL [id=foo] [gender=M] [pos=0 0 0]",
      "parts/clearbare_c.dat": "0 !LDCAD SNAP_CLEAR",
    });
    const { metas, hadData } = await collectSnapMetas("clearbare_parent.dat", lib, shadow);
    expect(hadData).toBe(true); // data existed at some point in the closure
    expect(metas).toEqual([]); // but was wiped by the bare SNAP_CLEAR
  });

  it("id-scoped SNAP_CLEAR removes only the named meta, across mixed key/value casing", async () => {
    // Definer uses an uppercase key with mixed-case value; clearer uses a
    // lowercase key with a different value casing. Both must match.
    const shadow = fakeShadow({
      "parts/clearid_b.dat":
        "0 !LDCAD SNAP_CYL [ID=axleHole] [gender=F] [pos=0 0 0]\n" +
        "0 !LDCAD SNAP_CYL [id=other] [gender=M] [pos=1 0 0]",
      "parts/clearid_c.dat": "0 !LDCAD SNAP_CLEAR [id=AXLEHOLE]",
    });
    const { metas, hadData } = await collectSnapMetas("clearid_parent.dat", lib, shadow);
    expect(hadData).toBe(true);
    expect(metas).toHaveLength(1);
    expect(metas[0]!.meta.attrs.id).toBe("other");
  });

  it("SNAP_INCL pulls in another file's metas at the right transform", async () => {
    const shadow = fakeShadow({
      "parts/snapincl_parent.dat":
        "0 !LDCAD SNAP_INCL [ref=snapincl_ref.dat] [pos=0 10 0] [ori=1 0 0 0 1 0 0 0 1]",
      "parts/snapincl_ref.dat": "0 !LDCAD SNAP_CYL [gender=F] [pos=0 2 0]",
    });
    const { metas, hadData } = await collectSnapMetas("snapincl_parent.dat", lib, shadow);
    expect(hadData).toBe(true);
    expect(metas).toHaveLength(1);
    expect(metas[0]!.meta.type).toBe("SNAP_CYL");
    expect(translationOf(metas[0]!.xform)).toEqual([0, 10, 0]);
  });

  it("id-scoped SNAP_CLEAR removes every meta sharing that id, even independently-inherited ones (pinned current behaviour)", async () => {
    // clearmulti_a and clearmulti_b are independent subparts of the parent,
    // each contributing a meta with the same id -- a collision that
    // doesn't occur in the real corpus (its 11 distinct id tags are each
    // defined by exactly one primitive) but is possible in principle. This
    // pins the deliberate choice not to try to disambiguate: an id-scoped
    // SNAP_CLEAR removes ALL matches, not just one. See the SNAP_CLEAR
    // paragraph on collectSnapMetas's doc comment for the rationale.
    const shadow = fakeShadow({
      "parts/clearmulti_a.dat": "0 !LDCAD SNAP_CYL [id=shared] [gender=M] [pos=0 0 0]",
      "parts/clearmulti_b.dat": "0 !LDCAD SNAP_CYL [id=shared] [gender=F] [pos=1 0 0]",
      "parts/clearmulti_c.dat": "0 !LDCAD SNAP_CLEAR [id=shared]",
    });
    const { metas, hadData } = await collectSnapMetas("clearmulti_parent.dat", lib, shadow);
    expect(hadData).toBe(true);
    expect(metas).toEqual([]);
  });

  it("surfaces an unexpandable three-axis grid= rather than silently dropping cells", async () => {
    // The three-axis grid= extension (7 of 91 real grid= values) isn't
    // implemented -- its geometry can't be verified against any available
    // spec -- but per this tool's "nothing detected may be silently
    // discarded" principle, the drop must be visible to the caller: every
    // meta reached through the degraded expansion is tagged
    // gridDegraded, and the closure result counts how many grid
    // attributes were degraded.
    const shadow = fakeShadow({
      "parts/snapgrid3_parent.dat": "0 !LDCAD SNAP_INCL [ref=snapgrid3_ref.dat] [grid=1 2 1 0 -76 0]",
      "parts/snapgrid3_ref.dat": "0 !LDCAD SNAP_CYL [gender=F] [pos=0 0 0]",
    });
    const { metas, hadData, degradedGridCount } = await collectSnapMetas("snapgrid3_parent.dat", lib, shadow);
    expect(hadData).toBe(true);
    expect(degradedGridCount).toBe(1);
    expect(metas).toHaveLength(1);
    expect(metas[0]!.gridDegraded).toBe(true);
  });

  it("does not tag metas as gridDegraded when grid= expands cleanly, and reports degradedGridCount 0", async () => {
    const shadow = fakeShadow({
      "parts/snapgrid_parent.dat":
        "0 !LDCAD SNAP_INCL [ref=snapgrid_ref.dat] [pos=0 0 0] [ori=1 0 0 0 1 0 0 0 1] [grid=2 1 100 0]",
      "parts/snapgrid_ref.dat": "0 !LDCAD SNAP_CYL [gender=F] [pos=0 0 0]",
    });
    const { metas, degradedGridCount } = await collectSnapMetas("snapgrid_parent.dat", lib, shadow);
    expect(degradedGridCount).toBe(0);
    expect(metas).toHaveLength(2);
    for (const m of metas) expect(m.gridDegraded).toBeUndefined();
  });

  it("SNAP_INCL with grid= produces one instance per cell", async () => {
    const shadow = fakeShadow({
      "parts/snapgrid_parent.dat":
        "0 !LDCAD SNAP_INCL [ref=snapgrid_ref.dat] [pos=0 0 0] [ori=1 0 0 0 1 0 0 0 1] [grid=2 1 100 0]",
      "parts/snapgrid_ref.dat": "0 !LDCAD SNAP_CYL [gender=F] [pos=0 0 0]",
    });
    const { metas, hadData } = await collectSnapMetas("snapgrid_parent.dat", lib, shadow);
    expect(hadData).toBe(true);
    expect(metas).toHaveLength(2);
    const translations = metas.map((m) => translationOf(m.xform)).sort((a, b) => a[0] - b[0]);
    expect(translations).toEqual([
      [0, 0, 0],
      [100, 0, 0],
    ]);
  });

  it("hadData is false when nothing anywhere in the closure had data", async () => {
    const shadow = fakeShadow({});
    const { metas, hadData } = await collectSnapMetas("empty_parent.dat", lib, shadow);
    expect(hadData).toBe(false);
    expect(metas).toEqual([]);
  });

  it("hadData is true when data comes solely from an inherited primitive", async () => {
    // top.dat and mid.dat have no shadow data of their own; only the
    // deeply-nested leaf.dat does.
    const shadow = fakeShadow({
      "parts/leaf.dat": "0 !LDCAD SNAP_CYL [gender=M] [pos=0 0 0]",
    });
    const { hadData } = await collectSnapMetas("top.dat", lib, shadow);
    expect(hadData).toBe(true);
  });

  it("serves a repeated call from cache, and does not permanently cache a rejecting walk", async () => {
    let attempts = 0;
    const read = vi.fn(async (relPath: string): Promise<string | undefined> => {
      if (relPath.toLowerCase() === "parts/cachetest.dat") {
        attempts++;
        if (attempts === 1) throw new Error("simulated transient I/O error");
        return "0 !LDCAD SNAP_CYL [gender=M] [pos=0 0 0]";
      }
      return undefined;
    });
    const shadow: ShadowLibrary = { read };

    // First call: the underlying read rejects, so the whole walk rejects.
    await expect(collectSnapMetas("cachetest.dat", lib, shadow)).rejects.toThrow();

    // Second call: must retry rather than replaying the stale rejection.
    const second = await collectSnapMetas("cachetest.dat", lib, shadow);
    expect(second.metas).toHaveLength(1);
    expect(read).toHaveBeenCalledTimes(2);

    // Third call: the now-successful result is cached, so no further read.
    const third = await collectSnapMetas("cachetest.dat", lib, shadow);
    expect(third.metas).toHaveLength(1);
    expect(read).toHaveBeenCalledTimes(2);
  });
});
