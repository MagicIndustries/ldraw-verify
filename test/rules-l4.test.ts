import { describe, expect, it } from "vitest";
import type { ConnectionGraph } from "../src/connect/graph.js";
import { LibraryIndex } from "../src/library/index.js";
import { parseDocument } from "../src/parse/document.js";
import { resolveModel } from "../src/resolve/resolve.js";
import type { ResolvedModel } from "../src/resolve/ir.js";
import { l4Rules } from "../src/rules/l4-connectivity.js";
import type { RuleMeta } from "../src/rules/types.js";

const lib = await LibraryIndex.fromDirectory("test/fixtures/lib");
const meta: RuleMeta = { id: "B-06", name: "NO_FLOATING_PARTS", tier: "HARD", statement: "" };
const rule = l4Rules.find((r) => r.id === "B-06")!;

function modelWith(graph: ConnectionGraph, n: number) {
  const text = Array.from({ length: n }, (_, i) => `1 4 ${i * 20} -24 0 1 0 0 0 1 0 0 0 1 3001.dat`).join("\n");
  const m = resolveModel(parseDocument(text, "t.ldr"), lib);
  m.graph = graph;
  return m;
}

// Brief's original graph() helper only knew about edges/coverage/
// unknownPlacements/components. clipOnlyPlacements, degradedGridPlacements
// (task 10) and unreliableAxisPlacements (task 14) have since landed on
// ConnectionGraph (see connect/graph.ts) and are required fields, so this
// local fixture builder grew optional parameters for them, defaulting to
// empty so every test from the brief is unaffected unless it opts in.
const graph = (
  components: number,
  total: number,
  withData = total,
  extra: { clipOnlyPlacements?: number[]; degradedGridPlacements?: number[]; unreliableAxisPlacements?: number[] } = {},
): ConnectionGraph => ({
  edges: [],
  coverage: { withData, total, ratio: total === 0 ? 1 : withData / total },
  unknownPlacements: [],
  components,
  clipOnlyPlacements: extra.clipOnlyPlacements ?? [],
  degradedGridPlacements: extra.degradedGridPlacements ?? [],
  unreliableAxisPlacements: extra.unreliableAxisPlacements ?? [],
});

describe("B-06 no floating parts", () => {
  it("passes a single connected component", () => {
    expect(rule.run({ model: modelWith(graph(1, 2), 2), library: lib, meta })).toHaveLength(0);
  });

  it("fails when the model has more than one component", () => {
    const f = rule.run({ model: modelWith(graph(3, 3), 3), library: lib, meta });
    expect(f[0]!.status).toBe("fail");
    expect(f[0]!.message).toContain("3");
  });

  it("returns unknown when connectivity coverage is incomplete", () => {
    const f = rule.run({ model: modelWith(graph(2, 4, 2), 4), library: lib, meta });
    expect(f[0]!.status).toBe("unknown");
  });

  it("passes an empty model", () => {
    expect(rule.run({ model: modelWith(graph(0, 0), 0), library: lib, meta })).toHaveLength(0);
  });

  it("returns unknown when the model has no connectivity graph at all", () => {
    const m: ResolvedModel = resolveModel(parseDocument("1 4 0 -24 0 1 0 0 0 1 0 0 0 1 3001.dat", "t.ldr"), lib);
    // m.graph left undefined -- simulates a caller that bypasses the
    // registry's `needs: ["graph"]` gate. Must not silently read as pass.
    const f = rule.run({ model: m, library: lib, meta });
    expect(f[0]!.status).toBe("unknown");
  });

  // --- clip-only accounting ---------------------------------------------

  it("does not fail when the only extra component consists solely of clip-only placements", () => {
    // 2 components total: the main connected group, and one singleton
    // that buildGraph would have flagged in clipOnlyPlacements because
    // its only connecting meta is an unpairable SNAP_CLP (a flag on a
    // clip, a tool in a minifig hand). This is a legitimate model, not a
    // floating part, and must not fail.
    const g = graph(2, 3, 3, { clipOnlyPlacements: [2] });
    const f = rule.run({ model: modelWith(g, 3), library: lib, meta });
    expect(f).toHaveLength(0);
  });

  it("still fails a genuinely floating part even when a clip-only component is also present", () => {
    // 3 components: main group, one clip-only singleton (explained), and
    // one plain singleton with no clip/degraded signal at all -- a real
    // floating part. Subtracting the one clip-only component still
    // leaves 2 unexplained components, which must fail.
    const g = graph(3, 4, 4, { clipOnlyPlacements: [2] });
    const f = rule.run({ model: modelWith(g, 4), library: lib, meta });
    expect(f[0]!.status).toBe("fail");
    expect(f[0]!.message).toContain("3");
  });

  it("fails a genuinely floating part with no clip involvement at all", () => {
    const g = graph(2, 2, 2);
    const f = rule.run({ model: modelWith(g, 2), library: lib, meta });
    expect(f[0]!.status).toBe("fail");
  });

  // --- degraded-grid policy ----------------------------------------------
  // Policy: a degraded grid= expansion only ever under-reports hotspots,
  // so it can only ever make the graph look MORE fragmented than reality,
  // never less. It is therefore only ever grounds to soften a `fail` to
  // `unknown`, never to turn a `pass` into anything else, and never to
  // manufacture a `fail`. This test pins the softened-to-unknown case.
  it("downgrades an otherwise-failing component count to unknown when a degraded-grid placement is present", () => {
    const g = graph(2, 2, 2, { degradedGridPlacements: [1] });
    const f = rule.run({ model: modelWith(g, 2), library: lib, meta });
    expect(f[0]!.status).toBe("unknown");
    expect(f[0]!.message).toContain("grid");
  });

  it("does not let a degraded-grid signal turn a genuine pass into anything other than pass", () => {
    // Single component overall -- nothing to soften or fail regardless of
    // the degraded-grid placement's presence.
    const g = graph(1, 2, 2, { degradedGridPlacements: [1] });
    const f = rule.run({ model: modelWith(g, 2), library: lib, meta });
    expect(f).toHaveLength(0);
  });

  // --- unreliable-axis policy ---------------------------------------------
  // Same policy as degraded-grid: a non-orthonormal composed transform can
  // only make hotspotsCompatible's axis check reject a real pairing, never
  // fabricate one, so it can only ever soften a `fail` to `unknown`, never
  // manufacture one or touch a `pass`. See closure.ts's PlacedMeta.axisUnreliable.
  it("downgrades an otherwise-failing component count to unknown when an unreliable-axis placement is present", () => {
    const g = graph(2, 2, 2, { unreliableAxisPlacements: [1] });
    const f = rule.run({ model: modelWith(g, 2), library: lib, meta });
    expect(f[0]!.status).toBe("unknown");
  });

  it("does not let an unreliable-axis signal turn a genuine pass into anything other than pass", () => {
    const g = graph(1, 2, 2, { unreliableAxisPlacements: [1] });
    const f = rule.run({ model: modelWith(g, 2), library: lib, meta });
    expect(f).toHaveLength(0);
  });
});
