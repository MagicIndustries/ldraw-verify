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
