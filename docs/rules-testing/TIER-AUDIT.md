# Tier audit

How the 46 rules' tiers were decided, where that went wrong, and what to change.

Prompted by B-07, which was tiered HARD on a source that says bricks and plates
"should overlap whenever possible" and concedes in the same sentence that
building in stacks may have visual appeal. It hard-failed 10 of 244 real sets
for a bond its own source permits as a trade.

## The principle B-07 established

**A rule's tier comes from the force of its source, not from how checkable it
is.** B-07 became HARD because someone found a computable predicate inside a
broad stability paragraph, kept that clause, and dropped the hedging around it.
Nothing about the source got stronger; only our ability to test it did.

## Current distribution

| tier | physical | file | submission |
|---|---|---|---|
| HARD | 22 | 7 | 1 |
| DISCOURAGED | 6 | 4 | 1 |
| STYLE | 1 | 0 | 0 |
| LEGAL | 4 | 0 | 0 |

30 of 46 rules are HARD. For a corpus whose HARD definition is "stresses or
damages an element. Never emit; reject and re-plan", that is a lot of things
claimed to damage parts.

## Finding 1 — `LEGAL` is not a severity

`G-01`, `G-02`, `G-03`, `T-04` are tiered LEGAL, which was never defined in the
`tiers:` block. They are **permissions**: techniques that look illegal, or sit
next to something illegal, recorded so a generator does not "fix" them and a
reviewer does not flag them. A LEGAL rule can never be violated and never
fires.

Severity and permission are different axes. Putting a permission in the
severity column means `tier` cannot be sorted, compared or thresholded without
special-casing. **Recommend** a separate `kind` field (below).

## Finding 2 — several rules are facts, and a fact has no severity

These state something true about parts or about the format. Nothing can violate
them:

| rule | tier | what it actually is |
|---|---|---|
| `T-05` CURVED_SLOPES_ARE_ELLIPTICAL | HARD | a fact about part geometry |
| `T-04` MACARONI_LAW | LEGAL | a fact about part geometry |
| `T-03` ONLY_N4_CLOSES | HARD | a lattice theorem |
| `T-01` MEASURED_SLOPE_ANGLES | HARD | a fact about library naming, plus an instruction |
| `L-01` SYSTEM_TECHNIC_HEIGHT_MISMATCH | HARD | a dimensional fact |
| `E-01` MATRIX_WELL_FORMED | HARD | states the file format |
| `E-05` MPD_STRUCTURE | HARD | states the file format |

Note `T-05` and `T-04` are the same kind of thing — a geometric fact about a
part family — tiered HARD and LEGAL respectively. That inconsistency is the
clearest evidence the field is overloaded.

These are **reference data the generator needs**, not gates. `E-01` and `E-05`
already behave this way in code: the implemented predicates test
well-formedness, not the statement as written.

## Finding 3 — the tier definitions are physical-only

`HARD` is "stresses or damages an element"; `DISCOURAGED` is "out-of-system,
fragile, or degrades". Both were written for the `L-*`/`B-*` rules. Neither is
a test a malformed matrix can pass or fail, yet 7 HARD and 4 DISCOURAGED rules
are `domain: file`. Those tiers are assigned by analogy, never by the stated
definition. The new `domains:` block records the analogy explicitly.

## Finding 4 — `L-12` is a stub tiered HARD

Its whole statement is "Technic half-beams with System plates." — not a
sentence, with no condition. The corpus's own inventory marks it
"unimplementable as published — source lacks a precise condition". A rule
nobody can state should not carry the corpus's most severe tier.

## Finding 5 — two rules are not about builds at all

`B-09` (part count, palette) and `D-04` (build complexity) are BrickLink
Designer Program submission rules. They are now `domain: submission`. Outside
the BDP they do not apply, and a violation gets a submission rejected rather
than making a model wrong. `B-09` being HARD conflates those.

## Finding 6 — B-07's pattern, elsewhere

Rules phrased as prohibitions but which are structural-quality advice, where
the failure is weakness rather than damage:

| rule | tier | why it looks like B-07 |
|---|---|---|
| `T-08` TILES_ARE_SLIP_PLANES | HARD | a tile in a load path slips; nothing breaks |
| `T-06` NEVER_FORCE_A_BOW | HARD | derived technique advice about stressing a run |

`T-07` LOAD_BUDGET is the same family and is already DISCOURAGED, which is the
inconsistency. All three are `source_tier: S` — derived, not first-party.

## Recommendations

1. **Add `kind: constraint | reference | permission`.** Only `constraint`
   carries a tier. `reference` covers Finding 2; `permission` covers Finding 1
   and frees the tier column.
2. **Demote `T-08` and `T-06` to DISCOURAGED**, matching `T-07` and the B-07
   precedent: weakness is not damage, and both are derived sources.
3. **Drop `L-12` to STYLE or remove it** until someone can state its condition.
4. **Re-tier `B-09`** or scope it explicitly to BDP submission, now that
   `domain: submission` records what it is.
5. **Leave the 22 physical HARD rules alone.** Spot-checking their statements
   against `-ref-legality.md`, the prohibitive ones (`B-01`–`B-06`, `B-08`,
   most `L-*`) are genuinely stated as prohibitions by first-party sources.
   The problem is concentrated in the derived `T-*` rules and the facts.

## Applied — 2026-08-22

All four were applied.

**1. `kind: constraint | reference | permission`.** 41 / 2 / 3. Only a
constraint carries a tier; the other two omit the field rather than parking a
meaningless value in it. `LEGAL` is retired — the rules that used it are now
`kind: permission`, and `T-05` joined `T-04` as `kind: reference`, which is
what resolves the "same statement, two severities" inconsistency.

`Registry` now decides what to execute from `kind` rather than inferring it
from `tier === "LEGAL"`. Permissions and references report `informational` and
are never evaluated. `STYLE` stays a real tier on a real constraint — a rule
that *can* be violated but never gates — which is what `L-12` and `T-11` are.

**2. `T-08` and `T-06` demoted to DISCOURAGED**, matching `T-07`. Weakness is
not damage, and both are derived sources.

**3. `L-12` dropped to STYLE**, not removed. Its statement names no condition,
so nothing can violate it — but unlike `L-03`, which was *wrong* and deleted,
this one is merely *unstated*, and deleting it would lose a pointer at a real
interaction. Restore a severity when someone can write the condition down.

**4. `B-09` scoped rather than re-tiered.** `domain: submission` now carries
the scope, and the `tiers:` block says what each tier means within it: HARD
means "the submission is rejected", not "an element is damaged". The tier means
what it means *within* a rule's domain, never across domains.

Resulting distribution: HARD 26 (was 30), DISCOURAGED 13 (was 11), STYLE 2,
untiered 5. Every rule verdict over a 244-model corpus sample is unchanged —
this was a reclassification, not a behaviour change.

## Still open

`E-01`, `E-05`, `T-01`, `T-03` and `L-01` remain `constraint` although their
*statements* are written as facts. Each has a real implied constraint and, for
`E-01` and `E-05`, a working predicate that tests it — the statements are what
need rewriting, not the kind. Finding 2 above overcounted by listing them as
references; only `T-04` and `T-05` are irreducibly facts.
