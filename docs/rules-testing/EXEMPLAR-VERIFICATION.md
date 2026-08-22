# Exemplar verification record

Every `.ldr` in `test/fixtures/canon/` is a hand-authored miniature that must
demonstrate exactly one rule. This document records how each was verified and
what the verification changed.

## Method

The method that corrected B-01, applied to every exemplar:

1. **Read the target part's hotspots** — `scripts/part-hotspots.mjs <part>.dat`
   prints every `SNAP_*` connection point in part-local coordinates with its
   gender, axis, radius, `caps=` and `slide=`.
2. **Place the mating part so its hotspot coincides in both position and axis.**
   Coincidence must be exact: the pairing tolerance is 1 LDU, so a part that
   *looks* seated in a render can be silently unconnected.
3. **Measure the residual** — `scripts/exemplar-adrift.mjs` reports, for every
   unpaired placement, the distance to its nearest opposite-gender hotspot.
   A non-zero figure on a part that is meant to connect is a fixture bug.
4. **Confirm the intended rule fires** — `scripts/verify-exemplars.mjs` runs the
   full rule set over every fixture and reports which rules fire on each.

Steps 3 and 4 are the gate. Step 3 alone is not sufficient: for several rules
the misplacement *is* the violation, and snapping the part into place silently
destroys the thing the fixture exists to demonstrate.

## Result

| | |
|---|---|
| Illegal exemplars | 16 |
| …whose rule is implemented, and which fire it | **7 of 7** |
| …whose rule has no predicate yet (correctly silent) | 9 |
| Legal twins wrongly firing their own rule | **0** |

Every exemplar whose rule exists demonstrates it. No legal twin false-positives.

## What verification changed

Sixteen fixtures were geometrically wrong. The dominant error was systematic:
a mating part placed at the **centre** of a plate rather than on a **stud**.
On a 2×4 plate the studs sit at x=±10, ±30 and z=±10 — never at the origin — so
these parts floated 14.1 LDU (=√(10²+10²)) from any connection point.

| Exemplar | Was adrift | Correction |
|---|---|---|
| `B-01.illegal` | 14.0 LDU | Stud moved onto the pinhole hotspot at `[0,10,0]`; now fires B-01 |
| `B-01.legal` | 10.0 LDU | Seated on a real stud |
| `B-05.illegal` / `.legal` | 14.1 LDU | Moved off plate centre onto a stud; both lost a spurious B-06 |
| `E-04.legal` | 18.9 LDU | Brick re-seated (origin is on the *top* face, so a brick on a plate drops 24 LDU, not 8) |
| `G-01.legal` / `L-10.illegal` | 14.1 LDU ×2 | The two *supporting* plates re-seated — the wedged part deliberately left between studs |
| `G-02.legal` | 16.0 LDU | Re-seated |
| `L-01.illegal` | 30.3 LDU | Part was placed beyond the extent of the 1×2 brick it referenced |
| `L-03.illegal` | 14.0 LDU | Same 14 LDU miss as B-01; now genuinely puts four studs into four Technic holes |
| `L-04.legal` / `.illegal` | axis mismatch | Pin axis is local ±X but the hole's is +Z — a *rotation* error, not a position one. `.legal` now seats (3 edges); `.illegal` sits 10 LDU off-detent along the axis |
| `L-07.illegal` / `.legal` | 2.0 / 3.9 LDU | A click hinge rotates about its **pin**, not the part origin; both now connect at 11.25° and 22.5° respectively |
| `T-08.illegal` | 8.0 LDU | Third brick re-seated |

## Fixtures where being adrift is the point

These were deliberately **not** snapped. An automated "make it connect" pass
breaks all of them, and the first attempt at this verification did exactly that
before the regression was caught by step 4:

- **`E-02.illegal`** (`-Y is up`) — the violation is a part stacked in the wrong
  Y direction. Correcting its position removes the violation.
- **`E-04.illegal`** (`GRID_ALIGNMENT`) — the violation is landing off the 2 LDU
  lattice. Snapping to the lattice removes the violation.
- **`L-04.illegal`** (`PIN_NOT_IN_CLICK`) — an unseated pin is the subject.
- **`G-01.legal` / `L-10.illegal`** (tile/plate *between* studs) — the wedged
  part must stay between two studs. Only the parts supporting it were corrected.
- **`B-06.illegal`** (disconnected part) — 48 LDU adrift by design.
- **`T-03.*`** (`ONLY_N4_CLOSES`) — a rosette illustration; the gaps are the
  finding. The 8-fold ring leaves eight separate components, the 4-fold does not.
- **`E-01.*`, `E-07.*`, `T-01.illegal`** — single-part files; no connection is
  possible or intended.

## Reproducing

```
LDCAD_SHADOW_DIR=/path/to/ldcad-shadow node scripts/verify-exemplars.mjs
LDCAD_SHADOW_DIR=/path/to/ldcad-shadow node scripts/exemplar-adrift.mjs
LDCAD_SHADOW_DIR=/path/to/ldcad-shadow node scripts/part-hotspots.mjs 3700.dat
```

The shadow library is CC BY-SA 4.0 and is never vendored — supply it by path.
