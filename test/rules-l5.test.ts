import { describe, expect, it } from "vitest";
import type { ConnectionGraph } from "../src/connect/graph.js";
import { LibraryIndex } from "../src/library/index.js";
import { parseDocument } from "../src/parse/document.js";
import { resolveModel } from "../src/resolve/resolve.js";
import { l5Rules } from "../src/rules/l5-legality.js";
import type { RuleMeta } from "../src/rules/types.js";

const lib = await LibraryIndex.fromDirectory("test/fixtures/lib");
const meta = (id: string): RuleMeta => ({ id, name: id, tier: "HARD", statement: "" });
const byId = (id: string) => l5Rules.find((r) => r.id === id)!;

// degradedGridPlacements and clipOnlyPlacements are required fields on
// ConnectionGraph (added by task 10/11 work, after this task's brief was
// written -- see task-12-report.md); both are set empty here since none of
// these fixtures exercise grid degradation or clip-only placements.
const emptyGraph = (total: number): ConnectionGraph => ({
  edges: [],
  coverage: { withData: total, total, ratio: 1 },
  unknownPlacements: [],
  degradedGridPlacements: [],
  clipOnlyPlacements: [],
  components: 1,
});

describe("B-05 no fractional rotation", () => {
  it("passes an axis-aligned placement", () => {
    const model = resolveModel(parseDocument("1 4 0 -24 0 1 0 0 0 1 0 0 0 1 3001.dat", "t.ldr"), lib);
    model.graph = emptyGraph(1);
    model.graph.singleStudParts = new Set([0]);
    expect(byId("B-05").run({ model, library: lib, meta: meta("B-05") })).toHaveLength(0);
  });

  it("fails a 45-degree yaw on a single-stud part", () => {
    const c = Math.SQRT1_2;
    const model = resolveModel(
      parseDocument(`1 4 0 -24 0 ${c} 0 ${c} 0 1 0 ${-c} 0 ${c} 3001.dat`, "t.ldr"),
      lib,
    );
    model.graph = emptyGraph(1);
    model.graph.singleStudParts = new Set([0]);
    const f = byId("B-05").run({ model, library: lib, meta: meta("B-05") });
    expect(f[0]!.status).toBe("fail");
  });

  it("returns unknown when no graph is available", () => {
    const model = resolveModel(parseDocument("1 4 0 -24 0 1 0 0 0 1 0 0 0 1 3001.dat", "t.ldr"), lib);
    expect(byId("B-05").run({ model, library: lib, meta: meta("B-05") })[0]!.status).toBe("unknown");
  });
});

describe("B-01 no stud in a Technic pinhole", () => {
  it("fails an edge from a stud-radius male hotspot into a Technic hole part", () => {
    const model = resolveModel(
      parseDocument(
        ["1 4 0 -24 0 1 0 0 0 1 0 0 0 1 3001.dat", "1 4 0 -48 0 1 0 0 0 1 0 0 0 1 3700.dat"].join("\n"),
        "t.ldr",
      ),
      lib,
    );
    model.graph = { ...emptyGraph(2), edges: [{ a: 0, b: 1, kind: "SNAP_CYL", at: [0, -34, 0], radius: 6 }] };
    const f = byId("B-01").run({ model, library: lib, meta: meta("B-01") });
    expect(f[0]!.status).toBe("fail");
  });

  it("passes when neither end is a Technic hole part", () => {
    const model = resolveModel(
      parseDocument(
        ["1 4 0 -24 0 1 0 0 0 1 0 0 0 1 3001.dat", "1 4 0 -48 0 1 0 0 0 1 0 0 0 1 3001.dat"].join("\n"),
        "t.ldr",
      ),
      lib,
    );
    model.graph = { ...emptyGraph(2), edges: [{ a: 0, b: 1, kind: "SNAP_CYL", at: [0, -34, 0], radius: 6 }] };
    expect(byId("B-01").run({ model, library: lib, meta: meta("B-01") })).toHaveLength(0);
  });

  it("passes an edge landing on a Technic hole part when the radius isn't a stud's", () => {
    const model = resolveModel(
      parseDocument(
        ["1 4 0 -24 0 1 0 0 0 1 0 0 0 1 3001.dat", "1 4 0 -48 0 1 0 0 0 1 0 0 0 1 3700.dat"].join("\n"),
        "t.ldr",
      ),
      lib,
    );
    // radius 2 is nowhere near the 6 LDU stud radius (+-0.5 tolerance), so
    // this must not be mistaken for a stud entering the pinhole even though
    // the far end is a Technic-hole part.
    model.graph = { ...emptyGraph(2), edges: [{ a: 0, b: 1, kind: "SNAP_CYL", at: [0, -34, 0], radius: 2 }] };
    expect(byId("B-01").run({ model, library: lib, meta: meta("B-01") })).toHaveLength(0);
  });

  it("returns unknown when no graph is available", () => {
    const model = resolveModel(
      parseDocument(
        ["1 4 0 -24 0 1 0 0 0 1 0 0 0 1 3001.dat", "1 4 0 -48 0 1 0 0 0 1 0 0 0 1 3700.dat"].join("\n"),
        "t.ldr",
      ),
      lib,
    );
    expect(byId("B-01").run({ model, library: lib, meta: meta("B-01") })[0]!.status).toBe("unknown");
  });
});
