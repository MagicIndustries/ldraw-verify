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

## Libraries

This tool consumes two separate LDraw-ecosystem libraries with different licences, and treats them differently as a result:

- **Official parts library** (CC BY 4.0) — fetched automatically and cached under `.cache/` (a build-time artifact, never committed). `src/library/fetch.ts` downloads it from `https://library.ldraw.org/library/updates/complete.zip` on first use.
- **LDCad shadow library** (CC BY-SA 4.0, needed from Task 9 onward) — **not fetched by this tool.** Its ShareAlike term propagates into derived data, so pinning and auto-downloading a mirror would risk both link rot and a licensing mistake. Install [LDCad](https://www.melkert.net/LDCad) yourself and point this tool at its `shadow/offLib` directory via the `--shadow-dir` CLI flag or the `LDCAD_SHADOW_DIR` environment variable.
