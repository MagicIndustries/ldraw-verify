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
