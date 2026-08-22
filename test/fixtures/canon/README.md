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
