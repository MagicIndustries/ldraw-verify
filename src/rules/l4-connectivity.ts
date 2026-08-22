import type { Placement } from "../resolve/ir.js";
import type { Finding, Rule, RuleContext } from "./types.js";

/**
 * B-06 / NO_FLOATING_PARTS.
 *
 * The governing constraint: this rule must fail a model only when it
 * genuinely knows the model is in more than one piece. Where the
 * connectivity data is incomplete, the honest answer is `unknown`, never
 * `fail` and never `pass`.
 *
 * WHAT CHANGED, AND WHY IT HAD TO
 * -------------------------------
 * The previous formulation gated on `coverage.ratio < 1`: it demanded
 * 100% connectivity coverage before judging the component count at all.
 * The design (docs/design.md) states the ~19% coverage gap is PERMANENT --
 * roughly a fifth of parts have no shadow data and never will. So that
 * gate could never open on a real model: measured over 24 real OMR sets,
 * B-06 returned `unknown` on 24 of 24, coverage running 74-96%. The only
 * input that ever reached a verdict was the two-brick test fixture. A
 * HARD rule that structurally cannot render a verdict on real input is not
 * a check; it is a placeholder that reads like one.
 *
 * The replacement rests on the asymmetry this whole layer already relies
 * on: missing connectivity data can only ever HIDE a connection, never
 * invent one (see `ConnectionGraph.incompleteDataPlacements` for the four
 * ways data goes missing, and why each is one-directional). Consequences,
 * in the order this rule applies them:
 *
 * 1. ONE COMPONENT IS A SOUND PASS, AT ANY COVERAGE. If the graph already
 *    says the model is in one piece, no hidden edge can make it more than
 *    one piece -- hidden edges only ever merge components. The old gate
 *    reported `unknown` here, refusing to state a conclusion its own data
 *    fully supported.
 *
 * 2. NO GAPS ANYWHERE MEANS THE COUNT IS EXACT -- UNDER AN ASSUMPTION, NOT
 *    UNCONDITIONALLY SOUND. If no placement in the model is in
 *    `incompleteDataPlacements`, there is nowhere for a hidden edge to
 *    originate PROVIDED every real connection this rule could have paired
 *    would in fact have been paired. That provision is not automatic:
 *    `hotspotsCompatible` (connect/graph.ts) requires the two sides of a
 *    pairing to share a `kind`, which is stricter than LDCad's own pairing
 *    rules, so a real connection between two differently-kinded connectors
 *    is missed even when both sides have complete data -- a gap clause 2
 *    does not, and structurally cannot, account for, because it only looks
 *    at whether data is present, not at whether the pairing logic covers
 *    every real mating this data supports. VERIFICATION PASS: this clause
 *    is stated here as an assumption rather than as soundness for exactly
 *    that reason (the previous fix wave's report called all three clauses
 *    "sound", which overstated this one). Currently LATENT rather than
 *    live: all 98 real OMR models sampled while validating this rule had at
 *    least one data gap, so clause 2 has never actually fired on real input
 *    -- but "never yet observed" is not "cannot happen", and a model with
 *    genuinely complete data everywhere plus a kind-mismatched real
 *    connection would trip this exact gap. (This is the case the old ratio
 *    gate approximated -- but only via coverage, which sees the "no data at
 *    all" gap and not the degraded-grid, unreliable-axis or unmodelled-clip
 *    ones.)
 *
 * 3. A SEALED COMPONENT IS PROVABLY SEPARATE EVEN WHEN THE REST OF THE
 *    MODEL HAS GAPS -- GIVEN THAT ITS SHADOW DATA IS COMPLETE. A hidden
 *    connection has to land on a free connector. A component whose every
 *    placement is in `fullyAccountedPlacements` -- complete data, and every
 *    hotspot already consumed by an edge -- has no free connector for a
 *    hidden edge to attach to PROVIDED the shadow closure actually
 *    enumerated every physical connector the part has. It does not always:
 *    a part whose clip or bar mount is simply absent from its own shadow
 *    closure contributes no `SNAP_CLP` for the unpairable-kind check to see
 *    at all, so that placement can read as "fully accounted" (no
 *    MODELLED hotspot left unpaired) while carrying a real, physically
 *    present, entirely unmodelled connector. See the caveat below for the
 *    disclosure alongside clause 2's. When the shadow data genuinely is
 *    complete, though, the argument holds: if such a component exists
 *    alongside at least one other component, the model is genuinely in
 *    more than one piece, whatever the coverage elsewhere. This is the
 *    clause that lets the rule speak about a real model at all.
 *
 * 4. OTHERWISE, `unknown` -- and now with the specific components named,
 *    rather than a model-wide "coverage is not 100%".
 *
 * WHAT THIS RULE STILL CANNOT DO, STATED PLAINLY
 * ----------------------------------------------
 * Clause 3 is sound (under the shadow-completeness assumption above) but
 * rarely satisfied on a large real model: every exposed stud on a model's
 * surface is a free connector, so a component containing any outward-facing
 * stud is not sealed. Measured after this change (see
 * .superpowers/sdd/final-fix-report.md for the sample and the numbers),
 * B-06 still reports `unknown` on most real sets -- it just now reports it
 * for a stated, per-component reason instead of because 19% of parts will
 * never have shadow data. Closing that gap further needs something this
 * tool does not have: a geometric bound on where a data-less part's
 * unmodelled connectors could be, so that a free connector far from any
 * data-less part could be ruled out as a hiding place. That is a real,
 * implementable next step, and it is not implemented here.
 *
 * Three more caveats, disclosed together because they are all instances of
 * the same underlying risk -- this rule's soundness rests on the shadow
 * data and the pairing logic being a complete model of the part's real
 * physical connectors, and neither claim is checked against reality here:
 * - Clause 2's kind-matching gap (see clause 2 above): `hotspotsCompatible`
 *   requires two sides to share a `kind`, stricter than LDCad's own pairing
 *   rules, so a real connection between differently-kinded connectors is
 *   missed even at full coverage. Currently latent (unreachable on every
 *   real model sampled, all of which have data gaps), not live.
 * - Clause 3's shadow-completeness gap (see clause 3 above): a part whose
 *   clip or bar mount is absent from its own shadow closure can read as
 *   "fully accounted" while a real connector goes entirely unmodelled, so
 *   `fullyAccountedPlacements` is only as complete as the shadow library's
 *   own coverage of that part's physical connectors.
 *   (The one gap of this general shape that measurement actually caught --
 *   sliding axle/pin connectors, which mate anywhere along their axis while
 *   pairing only sees coincident positions -- IS accounted for: those
 *   placements are in `incompleteDataPlacements`, not silently trusted.)
 * - An `unreliableAxis` transform is treated as only ever able to reject a
 *   pairing, never fabricate one. A corrupted axis could in principle
 *   coincide with a real hotspot position AND satisfy the axis test, which
 *   would be a fabricated edge; that is judged implausible (a fabricated
 *   edge needs sub-LDU position coincidence too, which is a strong
 *   constraint) rather than impossible.
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

    const { total } = graph.coverage;
    if (total === 0) return [];

    // Clause 1: one component is a sound pass at any coverage -- hidden
    // edges can only merge components, never split them.
    if (graph.components <= 1) return [];

    const members = new Map<number, number[]>();
    for (let i = 0; i < total; i++) {
      const root = graph.componentOf[i];
      if (root === undefined) continue;
      const list = members.get(root);
      if (list) list.push(i);
      else members.set(root, [i]);
    }

    const locate = (indices: number[]): Finding["locations"] =>
      indices
        .slice(0, 10)
        .map((i) => model.placements[i])
        .filter((p): p is Placement => p !== undefined)
        .map((p) => ({ file: p.file, line: p.line, partId: p.partId }));

    // Clause 2: with no gap anywhere in the model, the component count is
    // exact and a count above 1 is a genuine multi-piece model.
    if (graph.incompleteDataPlacements.length === 0) {
      return [
        {
          ruleId: meta.id,
          tier: meta.tier,
          status: "fail",
          message:
            `model has ${graph.components} disconnected components; every placement's connectivity data ` +
            `is complete, so the component count is exact and every element must be connected`,
          locations: locate([...members.values()].flatMap((m) => m.slice(0, 1))),
          evidence: { components: graph.components, coverage: graph.coverage },
        },
      ];
    }

    // Clause 3: a component with no free connector anywhere in it cannot
    // be the far end of a hidden connection, so it is genuinely separate
    // from the rest of the model even though the rest has gaps.
    const accounted = new Set(graph.fullyAccountedPlacements);
    const sealed = [...members.values()].filter((m) => m.every((i) => accounted.has(i)));
    if (sealed.length > 0) {
      const sealedPlacements = sealed.flat();
      // "Sealed" (no free connector, complete data) proves this side is
      // separate from the rest of the model -- it does NOT mean this side
      // is the small floating part. A model's own main body can be sealed
      // too: fully enclosed, every stud consumed, nothing exposed. When the
      // sealed side outweighs everything else in the model, it IS the
      // model's own bulk, and a message/locations that blame it would point
      // a reader at the model's own main body instead of the actual
      // floating piece. Report whichever side is smaller as "floating" --
      // the sealed side when it's the minority (the ordinary case: a small
      // accessory proven disconnected), the complement when the sealed side
      // is the majority (a sealed main body; the smaller remainder is what
      // is actually floating relative to it).
      const sealedIsMainBody = sealedPlacements.length > total - sealedPlacements.length;
      const floating = sealedIsMainBody
        ? [...members.values()].filter((m) => !sealed.includes(m)).flat()
        : sealedPlacements;
      const message = sealedIsMainBody
        ? `model has ${graph.components} disconnected components; ${sealed.length} component(s) covering ` +
          `${sealedPlacements.length} placement(s) are this model's own main body: every placement in them ` +
          `has complete connectivity data and no unpaired connector, so no undetected connection can reach ` +
          `them from anywhere else in the model. That proves it is the other ${floating.length} ` +
          `placement(s) that are genuinely floating, not the main body. Every element must be connected`
        : `${sealed.length} component(s) covering ${sealedPlacements.length} placement(s) are connected only ` +
          `to themselves: every placement in them has complete connectivity data and no unpaired connector, ` +
          `so no undetected connection can reach them from the rest of the model's ${graph.components} ` +
          `components. Every element must be connected`;
      return [
        {
          ruleId: meta.id,
          tier: meta.tier,
          status: "fail",
          message,
          locations: locate(floating),
          evidence: {
            components: graph.components,
            sealedComponents: sealed.length,
            sealedPlacements: sealedPlacements.slice(0, 50),
            floatingPlacements: floating.slice(0, 50),
            coverage: graph.coverage,
          },
        },
      ];
    }

    // Clause 4: not decidable -- and say which components are the problem
    // and why, rather than reporting a model-wide coverage percentage.
    const unexplained = [...members.values()].filter((m) => m.some((i) => accounted.has(i)));
    return [
      {
        ruleId: meta.id,
        tier: meta.tier,
        status: "unknown",
        message:
          `model has ${graph.components} components and ${graph.incompleteDataPlacements.length}/${total} ` +
          `placement(s) whose connectivity data is incomplete (no shadow data, an unexpandable grid= form, ` +
          `a non-orthonormal transform, an unmodelled clip, a sliding axle/pin connector, or no ` +
          `modelled connector at all). Every ` +
          `component still has at least one unpaired connector or an incomplete placement, so a genuinely ` +
          `floating part cannot be distinguished from a connection this tool did not model`,
        locations: locate(graph.incompleteDataPlacements),
        evidence: {
          components: graph.components,
          coverage: graph.coverage,
          incompleteDataPlacements: graph.incompleteDataPlacements.length,
          componentsWithSomeAccountedPlacement: unexplained.length,
          degradedGridPlacements: graph.degradedGridPlacements.length,
          unreliableAxisPlacements: graph.unreliableAxisPlacements.length,
          clipOnlyPlacements: graph.clipOnlyPlacements.length,
        },
      },
    ];
  },
};

export const l4Rules: Rule[] = [noFloatingParts];
