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

## HARD rules known to reject real, legitimate models

Two `HARD`-tier rules are known to fire on a large share of real, released LEGO sets — not just malformed or synthetic files. They are kept `HARD` deliberately (the reasoning is in `rules/lego-build-rules.yaml` and the Task 14 report), but that means **a nonzero exit code from this tool does not reliably mean the model is broken.** If you gate automation on the exit code, read this first.

Measured against a 210-model sample of the OMR corpus (`.cache/omr/`, every 7th file by sorted set number, ~14.3% of the corpus; counted per model, not per finding):

- **`B-05` (`NO_FRACTIONAL_ROTATION`, HARD)** — fires on 54 of 107 applicable models (**50.47%**). The dominant real cause is rotationally-symmetric single-stud parts (round 1×1 plates, minifig heads, cones) and hinge-mounted accessories placed at an intentional yaw: these have no 90-degree "detent" to be fractional relative to, but the rule cannot yet tell that apart from a genuine off-grid tile/plate placement.
- **`B-06` (`NO_FLOATING_PARTS`, HARD)** — fires on 4 of 12 applicable models (**33.33%**). The two remaining real cases were not individually root-caused before this pass ended.

Treat a `HARD` failure from either rule as "needs a human look," not as proof the model is malformed.

`E-01` (`MATRIX_ROW_MAJOR`) is not `HARD` — it already sits at `DEMOTE` (4/203 applicable models, 1.97%) — but it has a separate, structural limitation worth knowing about: it **cannot detect a transposed (row-major/column-major mixed-up) rotation matrix**, described elsewhere as the single most common LDraw generator bug, at any tolerance. For a genuine rotation `R`, `transpose(R) == inverse(R)`, which is itself a perfectly valid, orthonormal rotation with determinant +1 — no orthonormality or determinant check can tell forward from transposed. This is a limit of what a single file can reveal, not a tunable tolerance; see `E-01`'s note and the `not_checkable` section in `rules/lego-build-rules.yaml`.

## Libraries

This tool consumes two separate LDraw-ecosystem libraries with different licences, and treats them differently as a result:

- **Official parts library** (CC BY 4.0) — fetched automatically and cached under `.cache/` (a build-time artifact, never committed). `src/library/fetch.ts` downloads it from `https://library.ldraw.org/library/updates/complete.zip` on first use.
- **LDCad shadow library** (CC BY-SA 4.0, needed from Task 9 onward) — **not fetched by this tool.** Its ShareAlike term propagates into derived data, so pinning and auto-downloading a mirror would risk both link rot and a licensing mistake. Install [LDCad](https://www.melkert.net/LDCad) yourself and point this tool at its `shadow/offLib` directory via the `--shadow-dir` CLI flag or the `LDCAD_SHADOW_DIR` environment variable.
