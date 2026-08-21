import { describe, expect, it } from "vitest";
import { verifyFile } from "../src/verify.js";
import { ruleOutcome } from "../src/rules/types.js";
import type { Status, Tier } from "../src/rules/types.js";

/**
 * Recall fixtures: hand-authored violating models paired with their legal
 * near-twins, proving each implemented rule fires when it should and stays
 * silent when it shouldn't. This is the recall half of the test strategy --
 * the precision harness (`scripts/omr-precision.ts`) already measures false
 * positives against 1,464 real sets; it says nothing about whether a rule
 * ever fires at all.
 *
 * The corpus and its tiers have moved since the task-15 brief was written
 * (see rules/lego-build-rules.yaml's TASK 14 notes): E-02 and E-07 were
 * demoted HARD -> DISCOURAGED, E-01's orthonormality tolerance was widened,
 * E-02 now reports `unknown` off an axis-misaligned transform, and B-01/
 * B-05/B-06 had semantic corrections (caps=/slide= gating, stud-radius/kind
 * scoping, clip-only and degraded-grid/unreliable-axis accounting). Every
 * case below was re-derived against the current corpus and predicates
 * rather than assumed from the brief -- each asserts the *tier* it actually
 * observed, not just fail/not-fail, so a future re-tiering shows up here as
 * a failing assertion instead of silently drifting. See
 * .superpowers/sdd/task-15-report.md for the full fixture matrix, which
 * fixtures matched the brief's original predictions and which didn't (all
 * eight of the brief's original assertions on fail/not-fail still hold;
 * only the E-02/E-07 tier changed), and the recall gaps this exercise
 * surfaced.
 */

const OPTS = { libraryRoot: ".cache/ldraw", corpusPath: "rules/lego-build-rules.yaml" };

interface Case {
  rule: string;
  tier: Tier;
  illegal: string;
  legal: string;
}

async function outcomeOf(path: string, rule: string): Promise<{ status: Status; tier: Tier }> {
  const r = await verifyFile(path, OPTS);
  const status = ruleOutcome(r.findings, rule);
  // ruleOutcome throwing (no finding at all for this ruleId) would already
  // fail the test before this line; every finding for one rule shares its
  // tier (the registry stamps `meta.tier` uniformly), so the first match is
  // representative of all of them.
  const tier = r.findings.find((f) => f.ruleId === rule)!.tier;
  return { status, tier };
}

// --- L0-L3 / L1 emitter-conformance rules: document- and placement-level
// only, no connectivity graph needed. ---------------------------------------
const CASES: Case[] = [
  // Brief's original four. All four still fire/stay-silent exactly as the
  // brief predicted; only E-02's and E-07's tier changed underneath the
  // same assertions (both demoted HARD -> DISCOURAGED, see the corpus
  // notes). E-01's fixture shear (b=0.5) is two orders of magnitude past
  // even the widened ORTHONORMAL_EPS (0.05), so the tolerance change did
  // not affect this fixture's outcome.
  { rule: "E-03", tier: "HARD", illegal: "e03-colour16.ldr", legal: "e03-concrete-colour.ldr" },
  { rule: "E-02", tier: "DISCOURAGED", illegal: "e02-positive-y.ldr", legal: "e02-negative-y.ldr" },
  { rule: "E-01", tier: "HARD", illegal: "e01-sheared.ldr", legal: "e01-rotated-y90.ldr" },
  { rule: "E-07", tier: "DISCOURAGED", illegal: "e07-moved-alias.ldr", legal: "e07-current-part.ldr" },

  // New coverage for the rest of the registered L0/L1 rules the brief didn't
  // reach.
  { rule: "E-05", tier: "HARD", illegal: "e05-content-before-file.ldr", legal: "e05-clean.ldr" },
  { rule: "E-08", tier: "HARD", illegal: "e08-invented-part.ldr", legal: "e08-real-part.ldr" },
  { rule: "E-10", tier: "HARD", illegal: "e10-bad-token-count.ldr", legal: "e10-well-formed.ldr" },
  { rule: "E-04", tier: "DISCOURAGED", illegal: "e04-off-grid.ldr", legal: "e04-on-grid.ldr" },
];

describe.each(CASES)("$rule", ({ rule, tier, illegal, legal }) => {
  it("fires on the violating fixture", async () => {
    const o = await outcomeOf(`test/fixtures/illegal/${illegal}`, rule);
    expect(o.status).toBe("fail");
    expect(o.tier).toBe(tier);
  });

  it("stays silent on the legal near-twin", async () => {
    const o = await outcomeOf(`test/fixtures/legal/${legal}`, rule);
    expect(o.status).not.toBe("fail");
    expect(o.tier).toBe(tier);
  });
});

// --- Connectivity-dependent rules (L4/L5): need the LDCad shadow library
// (CC BY-SA 4.0, never vendored -- see README's "Libraries" section) to
// build a connection graph at all. Skipped, not faked, when
// LDCAD_SHADOW_DIR isn't set, following golden.test.ts's existing pattern,
// so the suite stays green without it. -------------------------------------
const shadowDir = process.env.LDCAD_SHADOW_DIR;

const GRAPH_CASES: Case[] = [
  // A System stud (3024.dat, Plate 1x1) placed so its stud lands inside
  // 3700.dat's real Technic through-hole (shadow: connhole.dat,
  // caps=none, radius 6) vs the identical two parts with the stud instead
  // landing on 3700.dat's ordinary top antistud socket (caps=one) -- the
  // near-twin differs only in *which* real hotspot on the same two parts
  // the stud lands on, exactly the caps=none/caps=one distinction the
  // TASK-14 fix reads to tell a genuine pinhole violation from ordinary
  // top-of-brick stacking.
  { rule: "B-01", tier: "HARD", illegal: "b01-stud-in-pinhole.ldr", legal: "b01-stud-on-antistud.ldr" },
  // The same single-stud part (3024.dat) at a 45-degree yaw vs axis-aligned.
  { rule: "B-05", tier: "HARD", illegal: "b05-fractional-rotation.ldr", legal: "b05-axis-aligned.ldr" },
  // Two 3001.dat bricks placed 1000 LDU apart (no shared hotspot, two
  // components) vs the same two bricks stacked at the real 24 LDU
  // brick-height offset golden.test.ts already established mates into one
  // component.
  { rule: "B-06", tier: "HARD", illegal: "b06-disconnected.ldr", legal: "b06-stacked.ldr" },
];

async function graphOutcomeOf(path: string, rule: string): Promise<{ status: Status; tier: Tier }> {
  const r = await verifyFile(path, { ...OPTS, shadowDir: shadowDir! });
  const status = ruleOutcome(r.findings, rule);
  const tier = r.findings.find((f) => f.ruleId === rule)!.tier;
  return { status, tier };
}

describe.skipIf(!shadowDir).each(GRAPH_CASES)("$rule (connectivity)", ({ rule, tier, illegal, legal }) => {
  it(
    "fires on the violating fixture",
    async () => {
      const o = await graphOutcomeOf(`test/fixtures/illegal/${illegal}`, rule);
      expect(o.status).toBe("fail");
      expect(o.tier).toBe(tier);
    },
    30_000,
  );

  it(
    "stays silent on the legal near-twin",
    async () => {
      const o = await graphOutcomeOf(`test/fixtures/legal/${legal}`, rule);
      expect(o.status).not.toBe("fail");
      expect(o.tier).toBe(tier);
    },
    30_000,
  );
});

// Pending: L-10 (plate wedged between studs) vs G-01 (tile, legal). These are
// geometrically identical in LDraw and differ only by part class, so the pair
// is recorded here as the acceptance test for L-10 whenever it gains a
// predicate. See Task 12's scope note and the self-review notes in
// task-15-brief.md. L-10 is still `unimplemented` (no rule module registers
// it) as of this task -- see the "unimplemented rule acceptance tests" block
// below for its sibling pending markers.
describe.todo("L-10 vs G-01 part-class discrimination");

/**
 * Pending acceptance tests for every other corpus rule that is HARD or
 * DISCOURAGED (i.e. would otherwise be silently absent from a verdict) but
 * currently reports `unimplemented` because no rule module registers it.
 * Per this task's brief: "do not invent a passing test for an unimplemented
 * rule" -- each of these is a `todo`, not a real assertion, recording what
 * the fixture pair will assert once the rule gains a predicate, so the gap
 * is visible in the suite rather than just in the corpus YAML.
 *
 * LEGAL/STYLE-tier corpus entries (G-*, T-*, D-04 is DISCOURAGED but
 * check:none) are excluded here where they report `informational` rather
 * than `unimplemented` -- see Registry.run's tier branch -- except D-04,
 * which is DISCOURAGED with check:none and included below for completeness.
 */
describe.todo("unimplemented-rule acceptance tests (pending predicates)", () => {
  // check:none / explicitly "not mechanically checkable" -- see
  // not_checkable in the corpus. No LDraw-derivable predicate is possible
  // without external data these rules do not have.
  it.todo("B-02 NO_BENDING: check:none, unrepresentable in plain LDraw (no distinct bent-part encoding)");
  it.todo(
    "B-03 SNOT_LOGO_CLEARANCE: check:mesh, inflate stud radius 0.35 LDU excluding declared mating hotspot pairs; deferred pending mating-pair exclusion data (needs Task 10's connectivity layer, per the brief's self-review)",
  );
  it.todo("L-01 SYSTEM_TECHNIC_HEIGHT_MISMATCH: check:part_identity, but the 0.30 LDU error is absent from LDraw entirely -- not geometrically detectable from a model file");
  it.todo(
    "L-05 PIN_INTO_UNDERSIZED_BORE: check:part_identity, requires a part_property_db this tool does not have (parts: [3062b])",
  );
  it.todo(
    "L-06 CONE_ON_PIN_NO_STOP: check:part_identity, requires a part_property_db this tool does not have (parts: [3004, 4589])",
  );
  it.todo(
    "L-08 PC_ON_PC_SLIDING: check:part_identity, requires a material table (part x colour) this tool does not have",
  );
  it.todo("L-12 TECHNIC_HALFBEAM_WITH_SYSTEM_PLATE: check:none, \"unimplementable as published\" per its own corpus note");
  it.todo("D-04 BUILD_COMPLEXITY: check:none, no stated mechanical threshold");
  it.todo(
    "E-09 ORIGIN_NOT_COMPUTED: check:none by design -- no part-origin table is shipped; see verify.ts self-review deviation #1",
  );

  // check:{graph,grid,transform,mesh,inventory} WITH a stated predicate --
  // mechanically checkable in principle, just not yet implemented.
  it.todo(
    "B-04 MUST_BE_SEPARABLE: check:graph, predicate \"flag large plate-on-plate contact area\" -- would need a fixture with a large-area plate-on-plate stack (illegal) vs a small/staggered overlap (legal)",
  );
  it.todo(
    "B-07 MASONRY_BOND: check:grid, predicate \"no coincident vertical seam x between adjacent courses; min overlap 2 studs\" -- illegal: two courses with a repeated seam x; legal: staggered courses",
  );
  it.todo(
    "B-08 TECHNIC_SMOOTHNESS: check:graph, predicate \"drivetrain graph depth\", threshold unstated by the source -- cannot author a fixture until a threshold exists",
  );
  it.todo(
    "B-09 SUBMISSION_LIMITS: check:inventory, part-count/palette/economy limits -- illegal: a model over the stated submission limit; legal: one under it",
  );
  it.todo(
    "L-02 TECHNIC_HOLE_BRIDGED: check:graph, predicate \"connection-graph degree\" -- illegal: a stud bridging two Technic holes at once; legal: a single unbridged stud",
  );
  it.todo(
    "L-03 MULTI_STUD_INTO_TECHNIC_HOLES: check:graph, predicate \"count(studs entering technic holes of one part) <= 1\" -- illegal: two+ studs into one part's Technic holes; legal: one",
  );
  it.todo(
    "L-04 PIN_NOT_IN_CLICK: check:transform, predicate \"discrete axial position\" -- illegal: a Technic pin (3673/4274/2780) at a non-detent axial offset; legal: seated in its detent",
  );
  it.todo(
    "L-07 CLICK_HINGE_OFF_DETENT: check:transform, predicate \"rotation mod 22.5 == 0\" -- illegal: a click hinge at an off-detent angle; legal: a multiple of 22.5 degrees",
  );
  it.todo(
    "L-09 RECEIVER_SMALLER_THAN_CONNECTOR: check:mesh, \"THE ONLY rule in this corpus that is genuinely a collision test\" -- needs real mesh intersection, not yet implemented",
  );

  // Deliberately-DISCOURAGED, not implemented by design (superseded, or
  // measured to over-fire so badly it stays advisory-only in the corpus
  // itself rather than gated).
  it.todo("D-01 STUD_IN_TECHNIC_HOLE_UNBRIDGED: DISCOURAGED, superseded_by B-01 -- B-01 is the enforced rule, this stays unimplemented on purpose");
  it.todo(
    "D-02 OUT_OF_SYSTEM_HEIGHT: DISCOURAGED, predicate \"y mod 8 != 0\" -- corpus note: \"Over-fires badly on legitimate SNOT and jumper offsets. Advisory only.\", not implemented on purpose",
  );
  it.todo("E-06 NO_BFC_IN_MODELS: check:transform, \"emit no BFC statements in a model file\" -- illegal: a BFC statement in a model block; legal: none");
});
