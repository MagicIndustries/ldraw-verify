# B-01 across the full corpus

`B-01 NO_STUD_IN_PINHOLE` — "A System stud may not be inserted into a Technic
pinhole" — run over every model in the OMR corpus.

| | |
|---|---|
| Models scanned | **1,464** (0 errors) |
| Models with a B-01 finding | 17 (1.16%) |
| Total findings | 33 |
| Genuine violations | **0** |
| False positives | **33** |

No official set in the corpus breaks B-01. Every finding is a false positive.

## Why they fire

B-01 accepts an edge when three things hold: the connector radius is ~6 LDU,
the *female* side is `caps=none`, and the male side is not `slide=true`. It then
looks at the two parts and picks whichever one appears in the static
`technicHole` part-class list, reporting that part as the owner of the pinhole.

That last step never checks **which of the two parts actually owns the
`caps=none` bore.** Membership of the part-class list means only "this part has
a hole somewhere" — not "the hole is the thing being connected here".

`caps=none` means an opening with no closed end. A Technic pinhole is one. So is
a **hollow stud**, a round-brick barrel, and a cone bore. When a 1×1 round brick
with a hollow stud (`3062b`) is stacked normally on a Technic brick, the round
brick's own hollow anti-stud supplies the `caps=none` female, the Technic
brick's ordinary top stud supplies the male, and B-01 blames the Technic brick
for a pinhole that is nowhere near the connection.

Worked example, set `6641-1`: the `3062b` sits at world y=8 with its underside
at y=32. The `3700` Technic brick's top face is y=32 and its pinhole is at
y=42. The connection is at y=32 — the top stud, ten LDU clear of the hole.

Attributing each finding's bore to the placement that actually owns it:

| Attribution | Findings |
|---|---|
| Bore belongs to the *other* part (hollow stud, cone, round barrel) | 32 |
| Bore genuinely on the Technic part | 1 |

The single remaining case (`1682-1`, `3701` ↔ `4266`) is a wheel rim on a
Technic brick. `4266`'s only male connector is r=38 — the tyre seat — and all
its r=6 features are female pinholes with `slide=true`. There is no System stud
in the pairing at all, so it is a false positive too, by a different route:
B-01 never verifies the **male** side is a System stud.

## Two defects, not one

1. **Female attribution.** The `caps=none` female must be resolved to a specific
   placement, and *that* placement must be the Technic-hole part. The graph's
   `Edge` does not currently record which side was female, which is what makes
   this uncheckable inside the rule today.
2. **Male attribution.** The male side is never confirmed to be a System stud.
   Radius ~6 and "not sliding" also describes wheel hubs and other bosses.

Both are attribution problems in the same place: `Edge` carries `femaleCaps` and
`maleSlide` as bare values without recording which endpoint they came from.

## Related: duplicate edges

One physical connection can yield several edges. A Technic pin in a hole
produces three, of which only one carries `slide=true`, so B-01's `maleSlide`
guard is defeated by the pin's own duplicates — this is why `L-04.legal`, a
correctly seated pin, fires B-01. Across a 25-model sample, **15.3% of all
edges are same-point duplicates** and 117 connections have a `slide=true` edge
shadowed by a non-slide twin.

## Reproducing

`scripts/b01-corpus-scan.mjs` and `scripts/b01-attribution.mjs`. Note that
`verifyFile` rebuilds the parts library and the rule registry on **every** call;
hoisting both out of the loop took the full-corpus scan from roughly 45 minutes
to 3.
