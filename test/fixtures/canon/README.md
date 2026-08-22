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

Added exemplars for `L-01`, `L-03`, `L-04`, `L-07`, `E-02`, `E-04`, `E-07`, `G-02`,
`T-01` and `T-08`, taking coverage from 9 rules to 19.

| Exemplar | Fires | Note |
|---|---|---|
| `E-02.illegal` | `E-02`, `B-06` | correct |
| `E-04.illegal` | `E-04`, `B-06` | correct |
| `L-01`, `L-03`, `L-04` | nothing | correct: no predicate yet |
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
