# CANON exemplars

Minimal illegal/legal pairs authored from the build-rules corpus. Each illegal model
should fire exactly its own rule; each legal near-twin should stay silent.

Rendered versions appear in the corpus artifact.

## Verified behaviour at time of authoring

| Exemplar | Fires | Note |
|---|---|---|
| `B-06.illegal` | `B-06` | correct |
| `E-01.illegal` | `E-01` | correct |
| `B-05.illegal` | `B-05`, `B-06` | correct, but **impure** — an off-detent 1x1 also reads as disconnected |
| `B-07.illegal` | nothing | correct: `B-07` has no predicate yet |
| `L-10.illegal` | `B-06` | `L-10` has no predicate; the upright plate also reads as disconnected |
| `B-01.illegal` | **nothing** | **`B-01` is implemented and did not fire — see issue** |

## Two things these already found

**`B-01` did not detect a hand-authored stud-in-pinhole.** Either this exemplar's
geometry does not place the stud where the connectivity graph expects it, or `B-01`
has a recall gap. Not yet resolved — that is what the exemplar is for.

**Some violations cannot be isolated.** Rotating a single-stud part off its detent
also disconnects it, so `B-05.illegal` legitimately trips `B-06` too. The corpora
spec asks for exactly one violation per illegal model; for this class of rule that
may not be achievable, and the fixture should assert on its own rule rather than on
total finding count.

## Second batch

Added exemplars for `L-01`, `L-04`, `L-07`, `E-02`, `E-04`, `E-07`, `G-02`,
`T-01` and `T-08`, taking coverage from 9 rules to 19.

| Exemplar | Fires | Note |
|---|---|---|
| `E-02.illegal` | `E-02`, `B-06` | correct |
| `E-04.illegal` | `E-04`, `B-06` | correct |
| `L-01`, `L-04` | nothing | correct: no predicate yet |
| `L-07.illegal` | `B-06` | no predicate yet; hinge halves also read as unconnected |
| `T-08.illegal` | `B-06` | no predicate yet — but see below |

### `T-08` is confirmed by a different rule

The brick-tile-brick stack fires `B-06`. That is **not** a false positive: a brick
resting on a tile genuinely has nothing holding it, because a tile has no studs. The
connectivity rule independently demonstrates the very thing `T-08` states — that a
tile in a load path is a slip plane. Two rules derived from different sources agreeing
on the same physical fact is the strongest evidence either of them is right.

### The B-06 co-firing pattern is now well established

Six exemplars trip `B-06` alongside their own rule. In every case it is correct: an
off-lattice, off-detent, or tile-separated part really is unattached. Fixtures must
therefore assert on their own rule id, never on the total finding count.

## Removed exemplars

`L-03.{legal,illegal}.ldr` were deleted on 2026-08-22 along with the rule.
L-03 (`MULTI_STUD_INTO_TECHNIC_HOLES`, "never more than one stud into Technic
holes") was a misreading of its source: the source warns that System and Technic
do not share an edge datum, so System studs driven into Technic holes do not line
up. That is a flat incompatibility, not a budget of one stud. `B-01` already
states the ban flatly and is the rule to keep.

## When a legal twin is worth authoring

A legal twin earns its place by being a *near* twin: the same parts with one
thing changed, so the pair isolates the rule and nothing else. `B-01` puts the
stud on a stud instead of in a bore; `L-04` uses a full pin instead of a half
pin's short end in the same bore; `T-08` swaps one tile for a plate in the same
sandwich; `B-07` staggers the seams of the same wall.

`L-01` has no legal twin, on purpose. It forbids one specific connection -- a
System side-stud into a Technic bore -- and there is no legal way to make that
connection, so a "legal" version could only be some other arrangement of the
two bricks, which isolates nothing. Prefer no twin to a meaningless one.
