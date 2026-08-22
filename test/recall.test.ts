import { readFile } from "node:fs/promises";
import { beforeAll, describe, expect, it } from "vitest";
import { ALL_RULES, verifyFile } from "../src/verify.js";
import { LibraryIndex } from "../src/library/index.js";
import { loadCorpus } from "../src/rules/registry.js";
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

/**
 * Warms the shared `LibraryIndex` (see `src/library/index.ts`) before ANY
 * case in this file runs, `golden.test.ts`-style.
 *
 * `LibraryIndex.fromDirectory` now memoises process-wide, so only the
 * FIRST call in a worker pays the ~26k-file directory scan (~2.6s on a
 * warm filesystem cache, more under CPU contention) -- every call after
 * that is free. That memo removes the N-th scan, not the first: whichever
 * case runs first in this file's worker still has to pay it inline, inside
 * whatever timeout that individual `it` carries. The CASES block below
 * (E-03 first, at vitest's default 5s) was exactly that first caller, so
 * it timed out under contention even though the *real* defect (repeated
 * re-scanning) was already fixed. Paying the scan cost here, once, under
 * its own generous timeout, means no individual case has to budget for a
 * cold cache it happens to be first in line for.
 */
beforeAll(async () => {
  await LibraryIndex.fromDirectory(OPTS.libraryRoot);
}, 60_000);

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
  // even the widened ORTHONORMALITY_EPS (0.05), so the tolerance change did
  // not affect this fixture's outcome.
  { rule: "E-03", tier: "HARD", illegal: "e03-colour16.ldr", legal: "e03-concrete-colour.ldr" },
  // VERIFICATION PASS: illegal fixture swapped from e02-positive-y.ldr
  // (y = 24) to e02-odd-y.ldr (y = -25). E-02's y <= 0 clause was removed
  // (see l3-grid.ts's SYSTEM_LDU_QUANTUM doc comment and E-02's corpus
  // note), so a positive Y is no longer a violation and the old fixture
  // would silently stop exercising this rule at all. The new fixture
  // exercises the clause E-02 actually still has: y mod 2 != 0.
  { rule: "E-02", tier: "DISCOURAGED", illegal: "e02-odd-y.ldr", legal: "e02-negative-y.ldr" },
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
  // Tier assertion updated deliberately a SECOND time, DISCOURAGED -> HARD.
  // The demotion recorded here was withdrawn once the ~46%-of-real-sets
  // firing rate that motivated it was traced to a scope defect -- the rule
  // was judging yaw on parts for which yaw is unmeasurable or physically
  // free -- and fixed there instead. The fail/not-fail assertions are again
  // unchanged. See B-05's SCOPE FIX note in rules/lego-build-rules.yaml.
  //
  // This fixture is load-bearing for that fix rather than merely surviving
  // it: 3024.dat is a SQUARE 1x1 plate, whose connectors sit in exactly the
  // same two places as a round 1x1 plate's and which is told apart from one
  // only by its `S`-section anti-stud cavity. A symmetry exemption written
  // on connector POSITIONS alone would swallow this case and this pair
  // would go quiet.
  { rule: "B-05", tier: "HARD", illegal: "b05-fractional-rotation.ldr", legal: "b05-axis-aligned.ldr" },
  // Two 3001.dat bricks placed 1000 LDU apart (no shared hotspot, two
  // components) vs the same two bricks stacked at the real 24 LDU
  // brick-height offset golden.test.ts already established mates into one
  // component.
  { rule: "B-06", tier: "HARD", illegal: "b06-disconnected.ldr", legal: "b06-stacked.ldr" },
];

/**
 * The connectivity cases below keep a 30s timeout, but not because they pay
 * for the directory scan -- the top-level `beforeAll` above already warmed
 * the shared `LibraryIndex` before any case in this file (including these)
 * runs, so that cost is already sunk by the time any of these execute. It
 * stays as insurance for the shadow-library open (`openShadowLibrary`) and
 * the connectivity-graph walk itself, which are genuinely slower than a
 * plain `verifyFile` call and were never what made E-03 time out.
 */
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

// L-10 (plate wedged between studs) against G-01 (tile in the identical
// position, legal). The two fixtures differ in exactly one line -- the wedged
// element -- so this pair tests the part-class discrimination and nothing
// else. It was `describe.todo` until L-10 gained a predicate.
describe("L-10 vs G-01 part-class discrimination", () => {
  it("fires on the plate", async () => {
    const r = await verifyFile("test/fixtures/canon/L-10.illegal.ldr", { ...OPTS, shadowDir: shadowDir! });
    expect(r.findings.some((f) => f.ruleId === "L-10" && f.status === "fail")).toBe(true);
  }, 60_000);

  it("stays silent on the tile in the same position", async () => {
    const r = await verifyFile("test/fixtures/canon/G-01.legal.ldr", { ...OPTS, shadowDir: shadowDir! });
    expect(r.findings.some((f) => f.ruleId === "L-10" && f.status === "fail")).toBe(false);
  }, 60_000);
});

/**
 * Pending acceptance tests for every other corpus rule that is HARD or
 * DISCOURAGED (i.e. would otherwise be silently absent from a verdict) but
 * currently reports `unimplemented` because no rule module registers it.
 * Per this task's brief: "do not invent a passing test for an unimplemented
 * rule" -- each of these is a `todo`, not a real assertion, recording what
 * the fixture pair will assert once the rule gains a predicate, so the gap
 * is visible in the suite rather than just in the corpus YAML.
 *
 * LEGAL/STYLE-tier corpus entries are excluded here, because they report
 * `informational` rather than `unimplemented` -- see Registry.run's tier
 * branch. That is exactly TWO of the T-* entries (T-04 MACARONI_LAW is
 * LEGAL, T-11 SCALE_THRESHOLD is STYLE) and the three G-* ones; an earlier
 * version of this comment excluded the whole T-* block as "LEGAL/STYLE",
 * which silently dropped NINE HARD/DISCOURAGED rules from the inventory --
 * including T-09 SNOT_COMMENSURABILITY, which carries a stated `check:
 * grid` predicate and is therefore a genuinely implementable rule this
 * list was hiding. D-04 is DISCOURAGED with check:none and is included.
 *
 * The count this block must match: 31 corpus rules are HARD or DISCOURAGED
 * with no registered predicate; all of them belong here now that L-10 has
 * a predicate of its own. Both numbers are asserted
 * mechanically by "the pending inventory is complete" below, so this
 * comment cannot drift out of date without a test failing.
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
    "B-08 TECHNIC_SMOOTHNESS: check:graph, predicate \"drivetrain graph depth\", threshold unstated by the source -- cannot author a fixture until a threshold exists",
  );
  it.todo(
    "B-09 SUBMISSION_LIMITS: check:inventory, part-count/palette/economy limits -- illegal: a model over the stated submission limit; legal: one under it",
  );
  it.todo(
    "L-02 TECHNIC_HOLE_BRIDGED: check:graph, predicate \"connection-graph degree\" -- illegal: a stud bridging two Technic holes at once; legal: a single unbridged stud",
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

  // The T-* technique constants. HARD/DISCOURAGED and unimplemented, so
  // they belong in this inventory exactly as the B-*/L-*/D-*/E-* entries
  // above do -- they were missing from it entirely.
  it.todo(
    "T-09 SNOT_COMMENSURABILITY: check:grid, predicate \"(n_plate * 8 + n_brick * 24) mod 20 == 0\" -- the one T-* rule with a stated mechanical predicate, and the concrete implementable gap this inventory was hiding. Illegal: a SNOT sandwich whose plate/brick stack does not return to the stud pitch; legal: one that does (e.g. 5 plates == 2 studs, identity I1)",
  );
  it.todo(
    "T-01 MEASURED_SLOPE_ANGLES: HARD, no check kind -- a data table of measured slope angles, not a predicate over a model; would need a per-part angle table to compare a placement against",
  );
  it.todo(
    "T-02 EXACT_ROTATIONS_ARE_RATIONAL: DISCOURAGED, no check kind -- illegal: a Pythagorean-triple rotation emitted as a rounded decimal (cos 36.87 deg); legal: the exact rational 0.8/0.6. Needs a tolerance policy for \"is this decimal trying to be 0.8\" that the corpus does not state",
  );
  it.todo(
    "T-03 ONLY_N4_CLOSES: HARD, no check kind -- illegal: a rosette of N != 4 arms asserted to close on the stud lattice; legal: N == 4. Needs a notion of \"rosette\" the model file does not carry",
  );
  it.todo(
    "T-06 NEVER_FORCE_A_BOW: HARD, no check kind -- a bent part has no distinct LDraw encoding (cf. B-02), so a forced bow is not representable in a model file",
  );
  it.todo(
    "T-07 LOAD_BUDGET: DISCOURAGED, no check kind, confidence:low -- needs a per-part mass table and a load path; the corpus itself flags the figures as community measurement, not first-party",
  );
  it.todo(
    "T-08 TILES_ARE_SLIP_PLANES: HARD, no check kind -- \"never place a tile in a load path\" needs a load path, which needs structural analysis (L6, unsolved -- see not_checkable)",
  );
  it.todo(
    "T-10 BRACKET_NOT_COMMENSURATE: DISCOURAGED, no check kind, parts [99207, 99206, 44728, 99781] -- illegal: a bracket child face assumed grid-commensurate (the offset is 12 LDU); legal: geometry that accounts for it. Needs a per-part face-offset table",
  );
});

/**
 * The inventory above is a hand-maintained list, and a hand-maintained
 * list of "what is missing" is exactly the kind of thing that silently
 * stops being true. This asserts it against the corpus and the registered
 * predicates instead: every HARD/DISCOURAGED corpus rule with no predicate
 * must be named somewhere in this file. It caught nine missing T-* entries
 * and a stale count when it was written.
 */
describe("pending-rule inventory", () => {
  it("names every unimplemented HARD/DISCOURAGED corpus rule", async () => {
    const corpus = await loadCorpus(OPTS.corpusPath);
    const implemented = new Set(ALL_RULES.map((r) => r.id));
    const pending = [...corpus.values()]
      .filter((m) => (m.tier === "HARD" || m.tier === "DISCOURAGED") && !implemented.has(m.id))
      .map((m) => m.id);
    // Deliberately a plain mention check against this file's own source:
    // it guards COMPLETENESS (no pending rule silently absent from the
    // inventory), not the wording of any particular entry. A rule id
    // mentioned only in passing would satisfy it -- that is a much smaller
    // problem than a rule missing entirely, which is what actually
    // happened to the nine T-* entries.
    const source = await readFile(new URL(import.meta.url), "utf8");
    const unnamed = pending.filter((id) => !source.includes(id));
    expect(unnamed).toEqual([]);
    // 26 pending in the corpus, all named by the block above. Was 31 before L-03
    // was removed as a misreading, 30 before B-07 gained a predicate, and 29
    // before the 2026-08-22 tier audit took L-12 to STYLE (its statement names
    // no condition) and T-05 to kind:reference (a fact about part geometry
    // that nothing can violate). Neither is pending work any more.
    //
    // B-07 only implements the seam-repetition half of its statement; the
    // "min overlap 2 studs" clause is unchecked. It is off this list because
    // the rule now renders a verdict, not because the statement is fully
    // covered -- see the rule's doc comment in src/rules/l3-grid.ts.
    expect(pending).toHaveLength(26);
  });
});
