import type { Finding, Rule, RuleContext } from "./types.js";

/**
 * B-06 / NO_FLOATING_PARTS.
 *
 * The governing constraint (see task-11 brief): this rule must fail a model
 * only when it genuinely knows the model is in more than one piece. Where
 * the connectivity data is incomplete, the honest answer is `unknown`,
 * never `fail` and never `pass`.
 *
 * Two categories of "the tool knows it hasn't modelled this" feed into the
 * decision, on top of the coverage gate the brief already specifies:
 *
 * - `clipOnlyPlacements`: placements whose only connecting hotspots are
 *   SNAP_CLP. `hotspotsCompatible` (connect/graph.ts) refuses to pair a
 *   SNAP_CLP with anything, by design, because clips carry no gender data
 *   in the shadow library. A structural consequence of that refusal is
 *   that a clip-only placement can *never* gain an edge -- it is always a
 *   singleton component, on its own, regardless of where it physically
 *   sits. So every entry in `clipOnlyPlacements` accounts for exactly one
 *   component in `graph.components` that is not evidence of a floating
 *   part; it's evidence of an unmodelled-but-real attachment (a flag on a
 *   clip, a tool in a minifig hand, a hinge chain). Subtracting that count
 *   from `graph.components` before judging "more than one component"
 *   removes exactly the components this tool knows it cannot explain any
 *   other way, without needing per-component membership data (which
 *   `ConnectionGraph` does not expose -- see the file-level report for why
 *   that's a deliberate, safe simplification and not an oversight).
 *
 * - `degradedGridPlacements`: placements whose connectivity is
 *   under-reported because a `grid=` form was too complex to expand.
 *   Unlike clip-only placements, a degraded placement is *not* guaranteed
 *   to be a singleton -- the one fallback hotspot the degraded expansion
 *   still produced might coincide with something. So it cannot be
 *   subtracted from the component count the way clip-only placements can.
 *   What is knowable is the *direction* of the risk: under-reporting can
 *   only ever make the graph look more fragmented than reality (fewer
 *   hotspots means fewer possible edges), never less -- it can never
 *   manufacture a false connection. So degraded placements can only ever
 *   cast doubt on a `fail` verdict, never on a `pass`: if the adjusted
 *   component count is already <= 1, nothing here changes that. If it's
 *   > 1 while at least one degraded placement exists anywhere in the
 *   model, this tool cannot rule out "the missing grid cells would have
 *   connected it" as the explanation, so the verdict is downgraded from
 *   `fail` to `unknown` rather than asserted.
 *
 * - `unreliableAxisPlacements`: placements that collected at least one
 *   hotspot through a non-orthonormal composed transform (see
 *   `PlacedMeta.axisUnreliable` in closure.ts) -- most commonly a Technic
 *   pin/axle/bush connector reached via a shared connector-hole primitive
 *   reused at a different size deep in a part's own geometry. Confirmed
 *   directly against the real shadow library (Task 14 report):
 *   3713.dat ("Technic Bush with Two Flanges") has no shadow file of its
 *   own, and the only meta reachable through its geometry closure carries a
 *   determinant-20 composed transform, corrupting its hotspot's axis.
 *   `hotspotsCompatible`'s axis check (connect/graph.ts) can then reject a
 *   pairing that should have matched -- exactly the same "can only
 *   under-report, never over-report" direction as a degraded grid, so it is
 *   handled identically: only ever grounds to soften a `fail` to `unknown`,
 *   never to manufacture one or touch a `pass`.
 *
 * KNOWN FALSE-NEGATIVE SURFACE (TASK 14, not fixed in this pass): both
 * `unreliableAxisPlacements` and `degradedGridPlacements` soften this rule's
 * verdict for the WHOLE model, not just for the component(s) touching the
 * affected placement -- see the `unknown` branch below, which checks
 * "does either list have anything in it anywhere" rather than "is either
 * list's placement part of the unexplained component(s)". `ConnectionGraph`
 * does not expose per-component membership (see `explainedByClips` above
 * for the same limitation), so there is no cheap way to scope the
 * softening more tightly today. The practical consequence: a single
 * unrelated unreliable-axis or degraded-grid placement anywhere in a large
 * model can mask a genuinely floating, disconnected part elsewhere in that
 * same model, downgrading a real `fail` to `unknown` where a component-
 * scoped check would still have caught it. This predates the axis-
 * unreliable signal added in this pass, which widens the same gate rather
 * than narrowing it, so it is recorded here rather than left implicit.
 */
const noFloatingParts: Rule = {
  id: "B-06",
  needs: ["graph", "placements"],
  run({ model, meta }: RuleContext): Finding[] {
    const graph = model.graph;

    // Defensive only: the registry's `needs` gate keeps this from firing
    // without a graph in normal use, but a direct caller (or a future
    // refactor) bypassing that gate must not read as a silent pass --
    // an empty array here would synthesize to "pass" per the registry
    // contract, which would misreport "we never even checked" as "known
    // connected".
    if (!graph) {
      return [
        {
          ruleId: meta.id,
          tier: meta.tier,
          status: "unknown",
          message: "no connectivity graph was computed for this model; connectivity is not decidable",
          locations: [],
        },
      ];
    }

    const { total, withData, ratio } = graph.coverage;
    if (total === 0) return [];

    // Placements with literally zero shadow data (not clip-only, not
    // degraded -- no data reached at all) mean the tool cannot tell
    // "not connected" from "unmodelled" for them. Any such gap makes the
    // component count as a whole untrustworthy, so this is a blanket
    // gate ahead of the clip/degraded reasoning below, not something
    // clip-only or degraded accounting can rescue.
    if (ratio < 1) {
      return [
        {
          ruleId: meta.id,
          tier: meta.tier,
          status: "unknown",
          message: `connectivity data covers ${withData}/${total} placements (${Math.round(ratio * 100)}%); component count is not decidable`,
          locations: graph.unknownPlacements.slice(0, 10).map((i) => {
            const p = model.placements[i]!;
            return { file: p.file, line: p.line, partId: p.partId };
          }),
          evidence: { coverage: graph.coverage, components: graph.components },
        },
      ];
    }

    // Every clip-only placement is structurally guaranteed to be its own
    // singleton component (see doc comment above), so it can be
    // subtracted from the raw component count exactly, without needing
    // per-component membership: it accounts for precisely one "extra"
    // component that is explained, not floating.
    const explainedByClips = graph.clipOnlyPlacements.length;
    const adjustedComponents = graph.components - explainedByClips;

    if (adjustedComponents <= 1) return [];

    // Past this point the model looks like it has a genuinely floating
    // part -- unless there's a degraded-grid or unreliable-axis placement
    // anywhere that could be the (or an) actual explanation. Both signals
    // can only make components look more fragmented, never less, so they
    // are only ever grounds to soften a `fail`, never to manufacture or
    // hide one -- see this rule's doc comment for why each one only ever
    // under-reports.
    if (graph.degradedGridPlacements.length > 0 || graph.unreliableAxisPlacements.length > 0) {
      const reasons: string[] = [];
      if (graph.degradedGridPlacements.length > 0) {
        reasons.push(
          `${graph.degradedGridPlacements.length} placement(s) have under-reported connectivity from an unexpandable grid= form`,
        );
      }
      if (graph.unreliableAxisPlacements.length > 0) {
        reasons.push(
          `${graph.unreliableAxisPlacements.length} placement(s) have connectivity computed through a non-orthonormal transform`,
        );
      }
      const locations = [...graph.degradedGridPlacements, ...graph.unreliableAxisPlacements]
        .slice(0, 10)
        .map((i) => {
          const p = model.placements[i]!;
          return { file: p.file, line: p.line, partId: p.partId };
        });
      return [
        {
          ruleId: meta.id,
          tier: meta.tier,
          status: "unknown",
          message:
            `model has ${graph.components} components (${adjustedComponents} unexplained by clip-only ` +
            `connectors); ${reasons.join(" and ")}, so a genuinely floating part cannot be distinguished ` +
            `from a missed connection`,
          locations,
          evidence: {
            components: graph.components,
            adjustedComponents,
            degradedGridPlacements: graph.degradedGridPlacements,
            unreliableAxisPlacements: graph.unreliableAxisPlacements,
          },
        },
      ];
    }

    return [
      {
        ruleId: meta.id,
        tier: meta.tier,
        status: "fail",
        message:
          `model has ${graph.components} disconnected components (${adjustedComponents} unexplained by ` +
          `clip-only connectors); every element must be connected`,
        locations: [],
        evidence: { components: graph.components, adjustedComponents, clipOnlyPlacements: graph.clipOnlyPlacements },
      },
    ];
  },
};

export const l4Rules: Rule[] = [noFloatingParts];
