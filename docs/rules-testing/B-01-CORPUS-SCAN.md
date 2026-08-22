# B-01 across the full corpus

`B-01 NO_STUD_IN_PINHOLE` — "A System stud may not be inserted into a Technic
pinhole" — run over every model in the OMR corpus.

| | |
|---|---|
| Models scanned | **1,464** (0 errors) |
| Models with a finding — before the fix | 17 (1.16%) |
| Total findings — before | 33, of which **0** genuine |
| Total findings — after the attribution fix | **0** |

No official set in the corpus breaks B-01. Every finding was a false positive,
and all 33 are now gone. `B-01.illegal` still fires, so the fix cost no recall.

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

## Fixed — three attribution defects

All three had the same shape: `Edge` carried a value that describes *one side*
of a pairing without recording which side it came from, so a rule could not ask
its actual question.

1. **Which part owns the socket.** `Edge` now carries `female` and `male`
   placement indices. B-01 requires the Technic-hole part to be the *female*
   endpoint, so "a stud is in this part's hole" is now a claim the data
   supports. This removed 32 of the 33 findings.
2. **Which side the radius describes.** `Edge.radius` falls back between sides,
   so a stud-sized reading could be the socket's. `maleRadius` and
   `femaleRadius` are now recorded without fallback, and B-01 tests the male's
   own radius. Every genuine System stud primitive carries r=6, so this costs
   no recall. This removed the 33rd — a wheel rim whose only male connector is
   its r=38 tyre seat.
3. **Evidence split across duplicate edges.** A Technic pin in a hole yields
   three edges at one point and only one carries `slide=true`, so reading
   `maleSlide` off a single edge missed it and reported a correctly seated pin
   as a stud in a pinhole. B-01 now groups edges by the pair they join and
   where, and treats sliding evidence as applying to the whole connection.
   This is what fixed the `L-04.legal` canon fixture.

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
