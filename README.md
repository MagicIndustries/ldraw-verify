# ldraw-verify

Verifies LDraw/MPD **model** files against the LEGO build-rules corpus.

## What it does NOT do

- **No structural soundness verdict.** "Will it hold together" is unsolved in the open; there is no zero-tolerance geometric ground truth, because correctly-connected LEGO parts are supposed to interpenetrate.
- **No general collision detection.** Exactly one rule in the corpus (`L-09`) is genuinely an interference test.
- **No aesthetic or craft judgement.**
- **No build-order validation.** `0 STEP` records intent; nothing validates it.
- **No part-availability check.** That needs a BrickLink/Rebrickable inventory join.
- **Does not verify part files.** This tool verifies models.

## Provenance caveat

The `L-*` rules derive from a 2006 presentation its own author has stated is superseded by an unpublished in-house version. The `B-*` rules are current first-party BrickLink Designer Program rules and win where the two disagree.

## What the exit code means, and what it does not

| exit | meaning | measured on real released sets |
| --- | --- | --- |
| 0 | no `fail` at any tier | 5.10% |
| 1 | at least one `HARD` fail | 25.51% |
| 2 | no HARD fail, at least one `DISCOURAGED` fail | 69.39% |
| 3 | the tool itself could not run (bad arguments, unreadable input) | — |

**Gate automation on exit 1, never on "nonzero".** Those percentages are
measured, not estimated: a 98-model sample of the OMR corpus (`.cache/omr/`,
every 15th file by sorted set number, 6.7% of 1,464 models), scanned with the
LDCad shadow library present. Reproduce with
`node dist/scripts/omr-precision.js .cache/omr --every 15`.

The exit-1 figure was 3.06% until `B-05` was restored to `HARD`. That earlier
number was produced by `B-05` sitting at `DISCOURAGED`, not by the tool
agreeing with real sets more often: the rule's scope defect was fixed at its
root (see `B-05` below and its corpus note) and its remaining 22.45% is what
is left after that fix, reported rather than tiered away.

Exit 2 is advisory and is expected on the large majority of real, legal sets.
That is not a bug in the exit code; it is what `DISCOURAGED` means in the
corpus — "works but is out-of-system, fragile, or degrades" — and real
released sets legitimately do out-of-system things all the time.

## Measured false-positive and firing rates

An OMR model is a scan of a real, released set, so a **HARD** fail against one
is by definition a false positive (a released set contains no illegal
technique). A **DISCOURAGED** fail is not: it may be entirely true, and usually
is. The two tiers are therefore judged with different vocabularies —
`scripts/omr-precision.ts` measures both and never applies the HARD reading to
a DISCOURAGED rule.

HARD tier, per model, same 98-model sample (rules at 0.00% omitted: B-01, E-03,
E-05, E-08, E-10, B-06):

- **`B-05` (`NO_FRACTIONAL_ROTATION`)** — 22 of 98 models (**22.45%**), 147 fail
  findings. The harness's automatic verdict at that rate is `QUARANTINE`, and it
  has **not** been applied. `B-05` was briefly `DISCOURAGED`; it is `HARD` again,
  because the reason it was firing on ~46% of real sets turned out to be a scope
  defect and not a tier question. It was judging yaw on parts for which yaw is
  either unmeasurable (a round 1×1 plate, a minifig head, a cone: every connector
  round, coaxial and centred, so turning it moves nothing) or physically free (a
  part hung on a hinge, ball joint or round sliding shaft). Both classes are now
  derived from the shadow library's own connectivity data — not from a part list —
  and are out of scope. That took the rule from 420 findings on 45 models to 147
  on 22, WITHOUT losing the genuine violations the demotion had also silenced
  (`3040b` and `6091` still fail; there is an end-to-end regression test for each).
  What is left is not "parts with no detent" any more: 113 of the 147 are five
  parts with genuinely asymmetric connector footprints (`3024`, `30367c`, `3005`,
  `6587`, `3794b`), and 47 of the 147 share their exact local rotation with a part
  they are connected to — the signature of a whole sub-assembly rotated by writing
  the composed matrix on every part line rather than by rotating a submodel, a
  frame this tool cannot recover when no submodel boundary exists. Read a lone
  `B-05` failure as "check whether this part sits in a deliberately angled
  sub-assembly", and see its corpus note for the full measurement.

- **`E-01` (`MATRIX_WELL_FORMED`)** — 3 of 94 applicable models (**3.19%**).
  The harness's automatic verdict for that rate is `DEMOTE`, and it has **not**
  been applied: `E-01` is `tier: HARD` in `rules/lego-build-rules.yaml` and
  stays there. Its orthonormality tolerance was already set from a corpus-wide
  row-norm deviation histogram, and widening it further to absorb this residual
  would be weakening a predicate to make a number fall. Treat a lone `E-01`
  failure as "look at this matrix", not as proof of a defect.

`E-01` also has a structural limitation worth knowing about: it **cannot detect
a transposed (row-major/column-major mixed-up) rotation matrix**, described
elsewhere as the single most common LDraw generator bug, at any tolerance. For
a genuine rotation `R`, `transpose(R) == inverse(R)`, which is itself a
perfectly valid orthonormal rotation with determinant +1 — no orthonormality or
determinant check can tell forward from transposed. This is a limit of what a
single file can reveal, not a tunable tolerance; see `E-01`'s note and the
`not_checkable` section in `rules/lego-build-rules.yaml`. (The rule was named
`MATRIX_ROW_MAJOR` until it was renamed to match what it actually checks.)

DISCOURAGED tier, per model, same sample. These are firing rates, **not**
error rates:

- **`E-07` (`NO_DEPRECATED_PARTS`)** — 92/98 (**93.88%**). Almost certainly all
  true: a set authored decades ago references the part numbers that were
  current then, and many have since been renamed to `~Moved to` aliases.
- **`E-02` (`Y_IS_UP_NEGATIVE`)** — 65/73 (**89.04%**). A verification pass
  removed this rule's `y <= 0` clause (VERIFICATION PASS note in
  `rules/lego-build-rules.yaml`): "built up from a ground plane at y=0" is a
  generator convention, not a property every valid placement has — measured
  directly, real released sets place parts at y > 0 (e.g. hanging below a
  hinge point), which was already true and already stated in this rule's own
  corpus note before the clause was removed. Only the `y mod 2 == 0` lattice
  check remains.
- **`E-04` (`GRID_ALIGNMENT`)** — 60/69 (**86.96%**).

`E-02` and `E-04` are per-placement checks, so their per-model rate saturates:
one odd coordinate anywhere in a 1,900-part set fires the rule for that model.
Their per-finding counts fell roughly 5× in the final fix wave when both were
corrected to the System's actual 2 LDU lattice — a Technic hole axis sits 10 LDU
into the brick, which is not a multiple of 4, so *every* correctly seated
Technic pin violated `E-02`'s old `y mod 4 == 0`.

## `B-06` renders a verdict on very few real models

`B-06` (`NO_FLOATING_PARTS`) is the L4 connectivity rule, and it reports
`unknown` on most real sets — 95 of 98 in the sample above. This is disclosed
rather than hidden, because a rule that rarely speaks must not be presented as
an active check.

It used to be worse: it demanded 100% connectivity coverage before judging
anything, and the ~19% coverage gap is permanent, so it reached a verdict on
**zero** real models and only ever spoke about a two-brick test fixture. It now
renders a sound verdict wherever one exists — one connected component is a pass
at any coverage; a component with complete data and no unpaired connector is
provably separate even when the rest of the model has gaps — and says which
components and which gaps prevent a verdict otherwise. On the 98-model sample it
reached a verdict on 3 models, all `pass`, with no false positives.

What still blocks it: any outward-facing stud is a free connector, so a large
model's main component is essentially never "sealed". Closing that needs a
geometric bound on where a data-less part's unmodelled connectors could reach,
which is not implemented.

## Libraries

This tool consumes two separate LDraw-ecosystem libraries with different licences, and treats them differently as a result:

- **Official parts library** (CC BY 4.0) — fetched automatically and cached under `.cache/` (a build-time artifact, never committed). `src/library/fetch.ts` downloads it from `https://library.ldraw.org/library/updates/complete.zip` on first use.
- **LDCad shadow library** (CC BY-SA 4.0, needed from Task 9 onward) — **not fetched by this tool.** Its ShareAlike term propagates into derived data, so pinning and auto-downloading a mirror would risk both link rot and a licensing mistake. Install [LDCad](https://www.melkert.net/LDCad) yourself and point this tool at its `shadow/offLib` directory via the `--shadow-dir` CLI flag or the `LDCAD_SHADOW_DIR` environment variable.
