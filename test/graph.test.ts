import { describe, expect, it } from "vitest";
import { buildGraph, pairHotspots } from "../src/connect/graph.js";
import type { Hotspot } from "../src/connect/hotspots.js";
import type { ShadowLibrary } from "../src/connect/shadow.js";
import { LibraryIndex } from "../src/library/index.js";
import { fromLdraw, IDENTITY4 } from "../src/resolve/matrix.js";
import type { Placement, ResolvedModel } from "../src/resolve/ir.js";

const male: Hotspot = { kind: "SNAP_CYL", gender: "male", pos: [0, -24, 0], axis: [0, -1, 0], radius: 6 };
const female: Hotspot = { kind: "SNAP_CYL", gender: "female", pos: [0, -24, 0], axis: [0, -1, 0], radius: 6 };

describe("pairHotspots", () => {
  it("pairs a coincident male and female hotspot", () => {
    expect(pairHotspots([male], [female])).toHaveLength(1);
  });

  it("does not pair two males", () => {
    expect(pairHotspots([male], [male])).toHaveLength(0);
  });

  it("does not pair hotspots that are far apart", () => {
    const far = { ...female, pos: [0, -100, 0] as const };
    expect(pairHotspots([male], [far])).toHaveLength(0);
  });

  it("does not pair hotspots whose axes are perpendicular", () => {
    const sideways = { ...female, axis: [1, 0, 0] as const };
    expect(pairHotspots([male], [sideways])).toHaveLength(0);
  });

  // Finding 5: kind must be part of compatibility. Without this check, a
  // coincident, axis-aligned, opposite-gender SNAP_CYL/SNAP_GEN pair would
  // wrongly pair even though they're two different kinds of connector.
  it("does not pair coincident, opposite-gender hotspots of different kinds", () => {
    const gen: Hotspot = { ...female, kind: "SNAP_GEN" };
    expect(pairHotspots([male], [gen])).toHaveLength(0);
  });

  // Finding 3 (decision b): SNAP_CLP has no validated geometric pairing
  // rule, so it must never pair with anything -- not even another SNAP_CLP
  // that happens to carry an explicit opposite gender (the corpus has
  // exactly one SNAP_CLP with a [gender=] attribute at all; this tool
  // doesn't treat that as load-bearing).
  it("never pairs SNAP_CLP hotspots, even same-kind ones with opposite gender", () => {
    const clipM: Hotspot = { kind: "SNAP_CLP", gender: "male", pos: [0, 0, 0], axis: [0, -1, 0] };
    const clipF: Hotspot = { kind: "SNAP_CLP", gender: "female", pos: [0, 0, 0], axis: [0, -1, 0] };
    expect(pairHotspots([clipM], [clipF])).toHaveLength(0);
  });
});

// buildGraph needs a real LibraryIndex (private fields, backed by a real
// directory) but a fully in-memory ShadowLibrary -- same split closure.test.ts
// uses, for the same reason: fast, hermetic tests with no real part/shadow
// library on disk.
const lib = await LibraryIndex.fromDirectory("test/fixtures/graph");

function fakeShadow(entries: Record<string, string>): ShadowLibrary {
  const map = new Map(Object.entries(entries).map(([k, v]) => [k.toLowerCase(), v]));
  return {
    async read(relPath: string): Promise<string | undefined> {
      return map.get(relPath.toLowerCase());
    },
  };
}

function modelOf(placements: Placement[]): ResolvedModel {
  return { document: { path: "test.ldr", blocks: [], errors: [] }, placements, unresolved: [], cycles: [] };
}

function placement(index: number, partId: string, world = IDENTITY4): Placement {
  return { index, partId, colour: 16, world, submodelPath: [], file: "test.ldr", line: 1 };
}

describe("buildGraph", () => {
  it("pairs coincident hotspots across two placements into one edge and one component", async () => {
    const shadow = fakeShadow({
      "parts/male.dat": "0 !LDCAD SNAP_CYL [gender=M] [pos=0 0 0]",
      "parts/female.dat": "0 !LDCAD SNAP_CYL [gender=F] [pos=0 0 0]",
    });
    const model = modelOf([placement(0, "male.dat"), placement(1, "female.dat")]);
    const g = await buildGraph(model, lib, shadow);
    expect(g.edges).toHaveLength(1);
    expect(g.edges[0]).toMatchObject({ a: 0, b: 1, kind: "SNAP_CYL" });
    expect(g.components).toBe(1);
    expect(g.coverage).toEqual({ withData: 2, total: 2, ratio: 1 });
    expect(g.unknownPlacements).toEqual([]);
    expect(g.degradedGridPlacements).toEqual([]);
  });

  it("reports unknownPlacements and reduced coverage for a placement with no shadow data", async () => {
    const shadow = fakeShadow({
      "parts/male.dat": "0 !LDCAD SNAP_CYL [gender=M] [pos=0 0 0]",
    });
    const model = modelOf([placement(0, "male.dat"), placement(1, "unknown.dat")]);
    const g = await buildGraph(model, lib, shadow);
    expect(g.unknownPlacements).toEqual([1]);
    expect(g.coverage).toEqual({ withData: 1, total: 2, ratio: 0.5 });
    expect(g.edges).toHaveLength(0);
    expect(g.components).toBe(2);
  });

  it("surfaces degradedGridPlacements without dropping the meta the degraded expansion still produced", async () => {
    // Same unsupported three-axis grid= form as closure.test.ts's
    // snapgrid3 fixture: expandGridWithStatus falls back to the single
    // [0,0,0] cell and reports degraded:true.
    const shadow = fakeShadow({
      "parts/degraded.dat": "0 !LDCAD SNAP_INCL [ref=degradedref.dat] [grid=1 2 1 0 -76 0]",
      "parts/degradedref.dat": "0 !LDCAD SNAP_CYL [gender=F] [pos=0 0 0]",
      "parts/male.dat": "0 !LDCAD SNAP_CYL [gender=M] [pos=0 0 0]",
    });
    const model = modelOf([placement(0, "male.dat"), placement(1, "degraded.dat")]);
    const g = await buildGraph(model, lib, shadow);
    expect(g.degradedGridPlacements).toEqual([1]);
    expect(g.edges).toHaveLength(1);
  });

  // Finding 3 (decision b): a placement whose only connecting meta is
  // SNAP_CLP can never gain an edge (see hotspotsCompatible), so it would
  // look like a genuinely disconnected part -- a false failure for e.g. a
  // flag or a tool held only by a minifig hand's clip. clipOnlyPlacements
  // names it explicitly so a later component rule can tell "isolated
  // because of an unmodelled clip" apart from "actually disconnected".
  it("flags a placement whose only connectivity is SNAP_CLP via clipOnlyPlacements, without inventing an edge for it", async () => {
    const shadow = fakeShadow({
      "parts/male.dat": "0 !LDCAD SNAP_CYL [gender=M] [pos=0 0 0]",
      "parts/female.dat": "0 !LDCAD SNAP_CYL [gender=F] [pos=0 0 0]",
      // A real clip shape (radius/length/pos), same as the minifig hand's
      // own shadow file, but with no gender data -- because real SNAP_CLP
      // metas don't carry any.
      "parts/clip.dat": "0 !LDCAD SNAP_CLP [radius=4] [length=11] [center=true] [pos=0 -1 -10]",
    });
    const model = modelOf([placement(0, "male.dat"), placement(1, "female.dat"), placement(2, "clip.dat")]);
    const g = await buildGraph(model, lib, shadow);
    // The male/female pair still connects normally.
    expect(g.edges).toHaveLength(1);
    // The clip-only placement is isolated (no validated pairing rule for
    // it) but explicitly named, not silently dropped or silently failed.
    expect(g.clipOnlyPlacements).toEqual([2]);
    expect(g.components).toBe(2);
  });

  // Finding 4 (task-12): SNAP_CLP metas carry no gender attribute in the
  // real shadow library, so metasToHotspots defaults them to "male" (see
  // that file's doc comment). Without excluding unpairable kinds, a part
  // whose sole connecting hotspot is a bare clip -- a real shape in the
  // shadow library, e.g. 15210.dat "Roadsign Clip-on 2x2 Square with
  // C-Clip" or 92220.dat "Claw Hooked with Clip" -- would count as a
  // single-stud part even though it has no stud at all, wrongly subjecting
  // it to B-05's axis-alignment check.
  it("does not count a placement whose sole hotspot is a SNAP_CLP as a single-stud part", async () => {
    const shadow = fakeShadow({
      "parts/clip.dat": "0 !LDCAD SNAP_CLP [radius=4] [length=8] [center=true] [pos=0 0 0]",
    });
    const model = modelOf([placement(0, "clip.dat")]);
    const g = await buildGraph(model, lib, shadow);
    expect(g.singleStudParts).toEqual(new Set());
    expect(g.clipOnlyPlacements).toEqual([0]);
  });

  it("does not flag a placement in clipOnlyPlacements when it also has a non-clip connecting meta", async () => {
    const shadow = fakeShadow({
      "parts/female.dat": "0 !LDCAD SNAP_CYL [gender=F] [pos=0 0 0]",
      "parts/mixed.dat":
        "0 !LDCAD SNAP_CYL [gender=M] [pos=0 0 0]\n0 !LDCAD SNAP_CLP [radius=4] [length=8] [pos=10 0 0]",
    });
    const model = modelOf([placement(0, "mixed.dat"), placement(1, "female.dat")]);
    const g = await buildGraph(model, lib, shadow);
    expect(g.clipOnlyPlacements).toEqual([]);
    expect(g.edges).toHaveLength(1);
  });

  it("finds a coincident pair even when it straddles a spatial-hash bucket boundary", async () => {
    const shadow = fakeShadow({
      "parts/male.dat": "0 !LDCAD SNAP_CYL [gender=M] [pos=0 0 0]",
      "parts/female.dat": "0 !LDCAD SNAP_CYL [gender=F] [pos=0 0 0]",
    });
    const identRot: [number, number, number, number, number, number, number, number, number] = [
      1, 0, 0, 0, 1, 0, 0, 0, 1,
    ];
    // Exactly 1.0 LDU apart (the pairing tolerance) but placed either side
    // of an integer bucket boundary (bucket size == tolerance): male
    // quantises to cell -1, female to cell 0 along X.
    const model = modelOf([
      placement(0, "male.dat", fromLdraw([-0.05, 0, 0], identRot)),
      placement(1, "female.dat", fromLdraw([0.95, 0, 0], identRot)),
    ]);
    const g = await buildGraph(model, lib, shadow);
    expect(g.edges).toHaveLength(1);
  });

  it("handles thousands of placements without quadratic blowup", async () => {
    const shadow = fakeShadow({
      "parts/male.dat": "0 !LDCAD SNAP_CYL [gender=M] [pos=0 0 0]",
      "parts/female.dat": "0 !LDCAD SNAP_CYL [gender=F] [pos=0 0 0]",
    });
    const identRot: [number, number, number, number, number, number, number, number, number] = [
      1, 0, 0, 0, 1, 0, 0, 0, 1,
    ];
    const pairs = 5000;
    const placements: Placement[] = [];
    for (let k = 0; k < pairs; k++) {
      // Each pair sits 20 LDU from its neighbours -- well outside the 1.0
      // LDU tolerance -- but coincident with its own partner, so buckets
      // stay small (~2 hotspots each) instead of collapsing to one giant
      // bucket, which is the realistic case for a real spread-out model.
      const x = k * 20;
      placements.push(placement(2 * k, "male.dat", fromLdraw([x, 0, 0], identRot)));
      placements.push(placement(2 * k + 1, "female.dat", fromLdraw([x, 0, 0], identRot)));
    }
    const model = modelOf(placements);
    const start = Date.now();
    const g = await buildGraph(model, lib, shadow);
    const elapsedMs = Date.now() - start;
    console.log(`buildGraph perf: ${placements.length} placements, ${g.edges.length} edges in ${elapsedMs}ms`);
    expect(g.edges).toHaveLength(pairs);
    expect(g.components).toBe(pairs);
    // Generous bound: a real O(n^2) placement-pair scan over 10000
    // placements would be 10^8 pair inspections and would not stay under
    // this on any reasonable machine; the bucketed version comfortably
    // does.
    expect(elapsedMs).toBeLessThan(5000);
  });
});

// Finding 4: the spatial-hash bucket-and-probe path in buildGraph had no
// evidence beyond one hand-picked boundary case and a performance test
// whose points are 20 LDU apart (never adjacent-bucket neighbours). This
// generates scattered hotspots with many near-coincident pairs -- some
// inside tolerance, some just outside, mixed genders and kinds -- and
// checks buildGraph's edge set against a brute-force pairHotspots-based
// oracle computed independently (every placement pair, not via the
// spatial hash), with a fixed seed so any failure reproduces exactly.
describe("buildGraph spatial-hash differential test", () => {
  // Deterministic PRNG (mulberry32) so a failure is exactly reproducible.
  function mulberry32(seed: number): () => number {
    let s = seed;
    return () => {
      s = (s + 0x6d2b79f5) | 0;
      let t = Math.imul(s ^ (s >>> 15), 1 | s);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  const identRot: [number, number, number, number, number, number, number, number, number] = [
    1, 0, 0, 0, 1, 0, 0, 0, 1,
  ];

  it("agrees with a brute-force pairHotspots oracle over scattered, near-coincident hotspots", async () => {
    const rand = mulberry32(0xc0ffee);
    const shadow = fakeShadow({
      "parts/cyl_m.dat": "0 !LDCAD SNAP_CYL [gender=M] [pos=0 0 0]",
      "parts/cyl_f.dat": "0 !LDCAD SNAP_CYL [gender=F] [pos=0 0 0]",
      "parts/gen_m.dat": "0 !LDCAD SNAP_GEN [gender=M] [pos=0 0 0]",
      "parts/gen_f.dat": "0 !LDCAD SNAP_GEN [gender=F] [pos=0 0 0]",
    });

    interface Generated {
      pos: [number, number, number];
      gender: "male" | "female";
      kind: "SNAP_CYL" | "SNAP_GEN";
    }
    const generated: Generated[] = [];
    const placements: Placement[] = [];

    // Clusters spread far apart (multiples of 50, tolerance is 1.0 LDU) so
    // only within-cluster pairs can plausibly coincide -- this keeps the
    // brute-force oracle's O(n^2) placement scan trivially fast while
    // still producing plenty of near-coincident and boundary-adjacent
    // pairs within each cluster.
    const CLUSTERS = 150;
    for (let c = 0; c < CLUSTERS; c++) {
      const cx = c * 50;
      const n = 2 + Math.floor(rand() * 4); // 2..5 points per cluster
      for (let k = 0; k < n; k++) {
        // Jitter spans roughly [-1.5, 1.5], straddling the 1.0 LDU
        // tolerance boundary in both directions so both "just inside" and
        // "just outside" pairs occur.
        const jitter = () => (rand() - 0.5) * 3;
        const pos: [number, number, number] = [cx + jitter(), jitter(), jitter()];
        const gender: "male" | "female" = rand() < 0.5 ? "male" : "female";
        const kind: "SNAP_CYL" | "SNAP_GEN" = rand() < 0.5 ? "SNAP_CYL" : "SNAP_GEN";
        generated.push({ pos, gender, kind });
        const partId = kind === "SNAP_CYL" ? (gender === "male" ? "cyl_m.dat" : "cyl_f.dat") : gender === "male" ? "gen_m.dat" : "gen_f.dat";
        placements.push(placement(placements.length, partId, fromLdraw(pos, identRot)));
      }
    }

    const model = modelOf(placements);
    const g = await buildGraph(model, lib, shadow);
    const actualPairs = g.edges.map((e) => `${e.a},${e.b}`).sort();

    // Independent brute-force oracle, built directly from the generated
    // ground truth (not from buildGraph's own hotspot extraction), and
    // compared pairwise via the real pairHotspots export.
    const expectedPairs: string[] = [];
    for (let i = 0; i < generated.length; i++) {
      for (let j = i + 1; j < generated.length; j++) {
        const gi = generated[i]!;
        const gj = generated[j]!;
        const hi: Hotspot = { kind: gi.kind, gender: gi.gender, pos: gi.pos, axis: [0, -1, 0] };
        const hj: Hotspot = { kind: gj.kind, gender: gj.gender, pos: gj.pos, axis: [0, -1, 0] };
        if (pairHotspots([hi], [hj]).length > 0) expectedPairs.push(`${i},${j}`);
      }
    }
    expectedPairs.sort();

    // Sanity check that this is a meaningful test, not a vacuous pass on
    // an empty edge set.
    expect(expectedPairs.length).toBeGreaterThanOrEqual(10);
    expect(actualPairs).toEqual(expectedPairs);
  });
});
