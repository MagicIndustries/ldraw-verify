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

/**
 * Fixture builder, rewritten for the B-06 reformulation (final fix wave,
 * item 3). Two deliberate changes from the previous version:
 *
 * 1. Components are given as explicit MEMBERSHIP (`[[0, 1], [2]]`), not as
 *    a bare count. B-06 now reasons about which placements are in which
 *    component -- `ConnectionGraph.componentOf` -- so a fixture that only
 *    supplies a number can no longer express what these tests are about.
 *
 * 2. The data-gap signal is `incompleteDataPlacements`, and `coverage` is
 *    DERIVED from it rather than set independently. The old builder let a
 *    fixture claim `coverage 2/4` while `unknownPlacements` was empty --
 *    an internally impossible graph that `buildGraph` could never produce,
 *    and which only "worked" because the old rule read the ratio and
 *    ignored the list. Fixtures now state the gap once.
 */
const graph = (
  componentMembers: number[][],
  extra: {
    incompleteDataPlacements?: number[];
    fullyAccountedPlacements?: number[];
    clipOnlyPlacements?: number[];
    degradedGridPlacements?: number[];
    unreliableAxisPlacements?: number[];
  } = {},
): ConnectionGraph => {
  const total = componentMembers.reduce((n, m) => n + m.length, 0);
  const componentOf = new Array<number>(total).fill(0);
  for (const m of componentMembers) for (const i of m) componentOf[i] = m[0]!;
  const incomplete = extra.incompleteDataPlacements ?? [];
  const withData = total - incomplete.length;
  return {
    edges: [],
    coverage: { withData, total, ratio: total === 0 ? 1 : withData / total },
    unknownPlacements: incomplete,
    components: componentMembers.length,
    componentOf,
    incompleteDataPlacements: incomplete,
    fullyAccountedPlacements: extra.fullyAccountedPlacements ?? [],
    clipOnlyPlacements: extra.clipOnlyPlacements ?? [],
    degradedGridPlacements: extra.degradedGridPlacements ?? [],
    unreliableAxisPlacements: extra.unreliableAxisPlacements ?? [],
  };
};

describe("B-06 no floating parts", () => {
  it("passes a single connected component", () => {
    expect(rule.run({ model: modelWith(graph([[0, 1]]), 2), library: lib, meta })).toHaveLength(0);
  });

  // THE headline change (final fix wave, item 3): one component is a sound
  // pass at ANY coverage, because a connection this tool failed to model
  // can only ever MERGE components, never split them. The previous
  // formulation returned `unknown` here -- refusing to state a conclusion
  // its own data fully supported -- because coverage was below 100%, which
  // the design says it permanently is on every real model.
  it("passes a single connected component even when connectivity data is incomplete", () => {
    const g = graph([[0, 1, 2]], { incompleteDataPlacements: [2] });
    expect(rule.run({ model: modelWith(g, 3), library: lib, meta })).toHaveLength(0);
  });

  it("fails when the model has more than one component", () => {
    const f = rule.run({ model: modelWith(graph([[0], [1], [2]]), 3), library: lib, meta });
    expect(f[0]!.status).toBe("fail");
    expect(f[0]!.message).toContain("3");
  });

  it("returns unknown when connectivity coverage is incomplete", () => {
    // Fixture corrected: the gap is now stated as the two placements whose
    // data is missing, instead of a coverage ratio contradicted by an
    // empty unknown-placement list. Same scenario, same expectation.
    const g = graph([[0, 1], [2, 3]], { incompleteDataPlacements: [2, 3] });
    const f = rule.run({ model: modelWith(g, 4), library: lib, meta });
    expect(f[0]!.status).toBe("unknown");
  });

  it("passes an empty model", () => {
    expect(rule.run({ model: modelWith(graph([]), 0), library: lib, meta })).toHaveLength(0);
  });

  it("returns unknown when the model has no connectivity graph at all", () => {
    const m: ResolvedModel = resolveModel(parseDocument("1 4 0 -24 0 1 0 0 0 1 0 0 0 1 3001.dat", "t.ldr"), lib);
    // m.graph left undefined -- simulates a caller that bypasses the
    // registry's `needs: ["graph"]` gate. Must not silently read as pass.
    const f = rule.run({ model: m, library: lib, meta });
    expect(f[0]!.status).toBe("unknown");
  });

  // --- a component that cannot be the far end of a hidden connection -----

  it("fails a sealed component even when the rest of the model has data gaps", () => {
    // Placements 0 and 1 form a component whose every placement has
    // complete data AND no unpaired connector, so no undetected connection
    // can reach it; placements 2-4's data is missing entirely. The gap
    // elsewhere is no reason to abstain about THIS component -- which is
    // the whole point of the reformulation. The sealed side (2 placements)
    // is deliberately kept smaller than the rest of the model (3
    // placements) so this exercises the ordinary case -- see the "main
    // body" test below for what happens when that's reversed.
    const g = graph([[0, 1], [2, 3, 4]], {
      incompleteDataPlacements: [2, 3, 4],
      fullyAccountedPlacements: [0, 1],
    });
    const f = rule.run({ model: modelWith(g, 5), library: lib, meta });
    expect(f[0]!.status).toBe("fail");
    expect(f[0]!.message).toContain("connected only to");
    // Locations name the sealed side (placements 0-1, lines 1-2), not the
    // gappy rest of the model (placements 2-4, lines 3-5).
    expect(f[0]!.locations.map((l) => l.line).sort()).toEqual([1, 2]);
  });

  // VERIFICATION PASS: when the SEALED component is the larger side -- the
  // model's own main body, fully enclosed with no exposed connector -- the
  // fail message and its locations must blame the smaller, genuinely
  // floating side instead. Clause 3's proof ("this component cannot be
  // joined to anything outside itself") is symmetric in which side it names
  // as separate; only the framing of which side is "the anomaly" needs to
  // track size, not which side happened to satisfy the sealed test.
  it("blames the smaller floating side, not the sealed main body, when the sealed component is the larger one", () => {
    const g = graph([[0, 1, 2, 3, 4], [5]], {
      incompleteDataPlacements: [5],
      fullyAccountedPlacements: [0, 1, 2, 3, 4],
    });
    const f = rule.run({ model: modelWith(g, 6), library: lib, meta });
    expect(f[0]!.status).toBe("fail");
    expect(f[0]!.message).toContain("main body");
    expect(f[0]!.message).not.toContain("connected only to");
    // Placement 5 is line 6 (1-indexed) in the fixture built by modelWith.
    expect(f[0]!.locations).toHaveLength(1);
    expect(f[0]!.locations[0]!.line).toBe(6);
  });

  it("returns unknown when no component is sealed and gaps exist", () => {
    // Same shape as above but placement 1 still has a free connector, so a
    // connection through placement 2's missing data cannot be ruled out.
    const g = graph([[0, 1], [2]], { incompleteDataPlacements: [2], fullyAccountedPlacements: [0] });
    const f = rule.run({ model: modelWith(g, 3), library: lib, meta });
    expect(f[0]!.status).toBe("unknown");
  });

  // --- clip-only accounting ----------------------------------------------
  // DELIBERATE EXPECTATION CHANGE (final fix wave, item 3). Both tests
  // below previously asserted that a clip-only component was ARITHMETICALLY
  // subtracted from the component count: one component of clip-only parts
  // made the model read as `pass`, two unexplained components still read as
  // `fail`. Neither claim was sound.
  //
  // A clip-only placement is one whose only connector is a SNAP_CLP, whose
  // real physical pairing (a clip gripping a bar) this tool does not model
  // at all. That means the tool does not know whether that part is attached
  // -- so reporting the model as `pass` reported something never checked as
  // checked, which is exactly what this project's central principle
  // forbids. And an unmodelled clip anywhere is a place a hidden connection
  // could originate, so it also blocks the "no gaps anywhere, the count is
  // exact" conclusion that the second test relied on. Both are now
  // `unknown`: the clip-only placement appears in
  // `incompleteDataPlacements`, and neither remaining component is sealed.
  it("returns unknown when the only extra component consists solely of clip-only placements", () => {
    const g = graph([[0, 1], [2]], { incompleteDataPlacements: [2], clipOnlyPlacements: [2] });
    const f = rule.run({ model: modelWith(g, 3), library: lib, meta });
    expect(f[0]!.status).toBe("unknown");
  });

  it("returns unknown for an apparently floating part while an unmodelled clip is present", () => {
    // 3 components: main group, one clip-only singleton, and one plain
    // singleton. The plain singleton LOOKS floating, but a lone brick's
    // studs are all free connectors, so it cannot be shown sealed while an
    // unmodelled clip exists anywhere in the model. Proving this case needs
    // a geometric bound on where the clip's unmodelled connector could
    // reach -- see B-06's doc comment.
    const g = graph([[0, 1], [2], [3]], { incompleteDataPlacements: [2], clipOnlyPlacements: [2] });
    const f = rule.run({ model: modelWith(g, 4), library: lib, meta });
    expect(f[0]!.status).toBe("unknown");
  });

  it("fails a genuinely floating part with no clip involvement at all", () => {
    const g = graph([[0], [1]]);
    const f = rule.run({ model: modelWith(g, 2), library: lib, meta });
    expect(f[0]!.status).toBe("fail");
  });

  // --- degraded-grid policy ----------------------------------------------
  // Policy unchanged: a degraded grid= expansion only ever under-reports
  // hotspots, so it can only ever make the graph look MORE fragmented than
  // reality, never less. It is therefore only ever grounds to soften a
  // `fail` to `unknown`, never to turn a `pass` into anything else, and
  // never to manufacture a `fail`. It reaches the rule via
  // `incompleteDataPlacements` now rather than as a separate model-wide
  // flag.
  it("downgrades an otherwise-failing component count to unknown when a degraded-grid placement is present", () => {
    const g = graph([[0], [1]], { incompleteDataPlacements: [1], degradedGridPlacements: [1] });
    const f = rule.run({ model: modelWith(g, 2), library: lib, meta });
    expect(f[0]!.status).toBe("unknown");
    expect(f[0]!.message).toContain("grid");
  });

  it("does not let a degraded-grid signal turn a genuine pass into anything other than pass", () => {
    const g = graph([[0, 1]], { incompleteDataPlacements: [1], degradedGridPlacements: [1] });
    const f = rule.run({ model: modelWith(g, 2), library: lib, meta });
    expect(f).toHaveLength(0);
  });

  // --- unreliable-axis policy ---------------------------------------------
  // Same policy as degraded-grid, for the same one-directional reason: a
  // non-orthonormal composed transform can only make hotspotsCompatible's
  // axis check reject a real pairing, never fabricate one.
  it("downgrades an otherwise-failing component count to unknown when an unreliable-axis placement is present", () => {
    const g = graph([[0], [1]], { incompleteDataPlacements: [1], unreliableAxisPlacements: [1] });
    const f = rule.run({ model: modelWith(g, 2), library: lib, meta });
    expect(f[0]!.status).toBe("unknown");
  });

  it("does not let an unreliable-axis signal turn a genuine pass into anything other than pass", () => {
    const g = graph([[0, 1]], { incompleteDataPlacements: [1], unreliableAxisPlacements: [1] });
    const f = rule.run({ model: modelWith(g, 2), library: lib, meta });
    expect(f).toHaveLength(0);
  });
});
