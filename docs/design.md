# LDraw verifier — design

**Date:** 2026-08-21 · **Status:** approved, not yet implemented · **Home:** new standalone repo, default name `ldraw-verify` (owner may rename at creation; this spec is authored in `research-test` because the rule corpus lives here)

Derived from [`docs/research/2026-08-21-lego-build-rules.md`](../../research/2026-08-21-lego-build-rules.md) and its three reference companions. Rule IDs referenced throughout come from [`docs/research/lego-build-rules.yaml`](../../research/lego-build-rules.yaml).

---

## 1. Why this exists

The research established that an agent generating LEGO models in LDraw/MPD can be checked far more cheaply than expected, but not by the obvious means. Of ~20 encodable rules traceable to primary sources, exactly one is a mesh-interference test; the rest are graph-theoretic or transform-level predicates. No open-source tool performs any of them. In particular, **no parser of the LDCad `!LDCAD SNAP_*` connectivity metadata exists in any language**, which is the single missing piece that unlocks structural predicates.

This tool is the durable asset: an agent-agnostic verifier that other work (a building agent, a comparison experiment, a Brickie pipeline check) can consume without depending on any of it.

## 2. Scope

**In scope — layers L0 to L4, plus the subset of L5 those enable.**

| Layer | Checks |
|---|---|
| L0 Syntax | Line types 0–5, token counts, numeric fields, CRLF, colour code validity |
| L1 References | Parts resolve, no reference cycles, no duplicate `0 FILE`, no `~Moved to` aliases or `~`-hidden parts |
| L2 Matrix | `det(R) == +1`, `R·Rᵀ == I`, no singular or non-uniformly scaled transforms |
| L3 Grid | X/Z multiples of 10, Y multiples of 4 and ≤ 0, integer coordinates, submodel placement alignment |
| L4 Connectivity | Hotspot extraction, support checks, engagement counts, connected-component count |
| L5 Legality | The `L-*`/`B-*` predicates whose dependencies L0–L4 satisfy |

**Explicitly out of scope.** These are stated in the README, not merely omitted — a verifier that implies it checks them is worse than one that says it cannot:

- Structural soundness ("will it hold together") — unsolved in the open; no zero-tolerance geometric ground truth exists.
- General collision detection — only `L-09` is genuinely an interference test.
- Aesthetic or craft judgement (seam staggering as *style*, colour blocking, greebling density).
- Build-order validity — `0 STEP` records intent; nothing validates it.
- Part availability in a given colour — needs a BrickLink/Rebrickable inventory join.
- Generating or validating *part* files (BFC geometry correctness). This tool verifies **models**.

## 3. Architecture

Three stages with a shared intermediate representation. Rules are a registry over the IR, not a pipeline stage.

### 3.1 Parse

LDraw/MPD text → AST.

- Line types 0–5 per [File Format 1.0.2](https://www.ldraw.org/article/218.html).
- MPD per [the MPD spec](https://www.ldraw.org/article/47.html): blocks are a **flat list**, first `0 FILE` is the main model, nesting is by reference only. Content before the first `0 FILE` is an error.
- CRLF tolerated on input, emitted on output.
- Colour codes preserved verbatim; resolution against `LDConfig.ldr` happens at check time, not parse time.
- **Written from scratch.** No npm LDraw dependency: `npm i ldraw` installs 2015 code because the `latest` tag was never moved, and three.js `LDrawLoader` carries a known-dangerous behaviour for this purpose. Both are documented decoys in the research.

### 3.2 Resolve → `ResolvedModel` (the IR)

A flattened placement list. Each placement carries:

- part ID and resolved library entry
- colour code
- world transform (composed as `M_world = M_parent · M_child`)
- submodel path (the chain of `0 FILE` blocks it came through)
- **source file and line number**

Provenance on every placement is load-bearing: it is what lets a finding point at a line an agent can actually edit.

**Part origins come from a table derived from the library, never computed from footprint.** Measured over a 250-part sample: only 24% have the standard studs-up signature, 43% have their origin off the footprint centre, 60% carry non-integer coordinates. The centroid formula breaks silently on parts as ordinary as a 2×1 45° slope (rule `E-09`).

### 3.3 Connection graph

A field on the IR, produced by the **hotspot extractor** — the scarce component, with its own module boundary and its own golden tests.

- Recursive closure walk over the LDCad shadow library. **Mandatory:** 65.8% of covered parts get their data only via inherited subparts and primitives; a 2×4 brick has no shadow file of its own. Reading only a part's own shadow file yields 15.3% coverage instead of 81.1%.
- Handles `SNAP_CYL`, `SNAP_CLP`, `SNAP_FGR`, `SNAP_GEN`, `SNAP_SPH`, plus `SNAP_INCL` (include another shadow file's info) and `SNAP_CLEAR` (drop inherited info), and expands `grid=` into repeated snap points.
- Edges are formed by pairing male and female hotspots at coincident world frames within a tolerance.
- Female connections are **not** always on the underside — open studs, round bricks and Technic holes carry them elsewhere.
- Parts with no data anywhere in their closure (~19%) yield **unknown**, never "no connections".

### 3.4 Rule registry

Metadata loads from `lego-build-rules.yaml`; predicates live in TypeScript. Each predicate declares which IR facts it requires.

- The corpus stays the single source of truth for IDs, tiers, check kinds and notes. Adding or re-tiering a rule is a data edit.
- A rule present in the YAML with no registered predicate reports as **unimplemented**, not as passing. The gap between "we know this rule" and "we check this rule" stays visible.
- A predicate whose declared IR dependency is unavailable returns **unknown**.

### 3.5 Report

JSON findings on stdout plus a human-readable renderer.

## 4. Findings model

Every finding is three-valued: `pass` | `fail` | `unknown`.

Fields: rule ID, tier (`HARD` / `DISCOURAGED` / `STYLE`), status, human message, source locations, and the evidence that triggered it.

Alongside findings, every run reports **connectivity coverage**: the percentage of placements with hotspot data. A clean result on a model that is 40% unknown must not read as a clean bill of health.

**Exit codes:** `0` clean · `1` any HARD violation · `2` DISCOURAGED only · `3` tool error.

**Unknowns never fail the run.** A verifier that blocks on its own ignorance gets switched off, and the ~19% coverage gap is permanent rather than a bug to be fixed.

## 5. Severity handling

The three tiers from the research note's §1 are honoured as behaviour, not just labels:

- **HARD** — reject. Exit 1.
- **DISCOURAGED** — report, exit 2, never block. This is where most useful technique lives; treating it as HARD makes a consuming agent timid and blocks legal builds.
- **STYLE** — advisory only, never a gate. These have no formal definition and gating on them produces confident nonsense.

## 6. Testing strategy

### 6.1 OMR as negative control — precision

The [Official Model Repository](https://www.ldraw.org/article/593.html) holds real released LEGO sets. Released sets contain no illegal techniques by construction, so **every HARD finding against an OMR model is a false positive** — a precision measurement over a large corpus with no hand labelling.

A per-rule false-positive rate falls out of this directly. **Any rule whose false-positive rate exceeds 1% of the OMR models it applies to is automatically demoted to DISCOURAGED**, and above 5% it is quarantined (reported as unimplemented). Both thresholds are provisional, chosen to be revisited once the first real measurement exists; the measured rate is recorded per rule either way. This is the mechanism that catches `D-02` (out-of-system height) before it reaches an agent — the research already flags it as over-firing on legitimate SNOT and jumper offsets.

### 6.2 Hand-authored fixtures — recall

Minimum one violating model per implemented rule ID, plus its legal near-twin where the distinction is subtle. The `G-01` / `L-10` pair is the canonical case: a tile wedged between studs is legal, a plate in the identical geometry is not, and they are **indistinguishable by geometry in LDraw** — only the part class separates them. If the fixture pair passes and fails respectively, the predicate is reasoning about the right thing.

### 6.3 Golden snapshots — the extractor

Pinned against facts independently verified during the research:

- Part `3001` resolves to 8 studs and 8 anti-studs.
- Brick-on-brick mating is exactly `T_B = T_A + (0, −24, 0)`.
- `stud2.dat` carries a female bore of inner radius 4, outer 6, pointing **downward from the top of the stud**.

### 6.4 Differential against LDView — cheap confidence

For the L0–L1 checks that overlap, assert agreement with headless LDView. Caveat recorded in the research: LDView always exits 0 and emits diagnostics only via stdout during rendering, so the harness parses stdout rather than trusting the exit code.

## 7. Licence boundary

The LDraw parts library is CC BY 4.0. **The LDCad shadow library is CC BY-SA 4.0 and ShareAlike propagates into derived connectivity data.**

Therefore:

- Both libraries are **fetched and cached at setup, never vendored** into the repo.
- Any generated hotspot artefact lands in its own directory with its own licence note, kept out of the core's licence.
- The core code carries a permissive licence; the derived data does not contaminate it.

Retrofitting this boundary later is miserable, so it is established before the first extraction runs.

## 8. Interfaces

- **CLI** — takes a file, emits JSON findings on stdout and a human rendering on stderr; flags to select rule set, library path, and minimum tier to report.
- **Library** — the same checks importable, returning the findings structure directly, for embedding in an agent loop or a browser view.
- **Browser debug view** — deferred but designed for: the IR plus findings is sufficient to render a model with flagged connections highlighted. This is the payoff for choosing TypeScript and the reason findings carry world positions as well as source lines.

## 9. Risks and known limits

| Risk | Detail | Mitigation |
|---|---|---|
| Coverage ceiling | Shadow data covers ~81% of parts; ~19% unknown, permanently | Three-valued findings; coverage reported per run; unknowns never fail |
| Corpus staleness | The `L-*` rules rest on a 2006 deck its own author calls superseded; the current LEGO rule set is unpublished | Prefer `B-*` (current BrickLink Designer Program) where they conflict; tier and date every rule in the YAML |
| `B-03` dependency | Stud inflation must exclude declared mating pairs, or it false-positives on every legal stack | Stays **disabled** until the extractor is real. This is the one rule where the two research streams conflicted; §2 of the research note holds the resolution |
| No part-property DB | Insertion stops, bore classes, PC-vs-ABS materials, tile-vs-plate class are absent from LDraw | Affected rules (`L-05`, `L-06`, `L-08`) report unimplemented until the table is authored |
| Unratified metadata | The snap-meta spec is explicitly unratified, stale, and proposes a different prefix from every real file | Parse what real files use (`0 !LDCAD SNAP_*`), not what the draft says |
| Ecosystem packaging | npm/cargo/PyPI LDraw packages are decoys | Parse from scratch; no LDraw runtime dependency |

## 10. Success criteria

1. Runs over the OMR corpus and reports a per-rule false-positive rate, with no rule silently over-firing.
2. Every implemented rule has a failing fixture and a passing near-twin.
3. The extractor reproduces the three golden facts in §6.3.
4. A findings JSON is actionable without the source: rule ID, tier, message, file and line.
5. Connectivity coverage is reported on every run.
6. The README states the out-of-scope list in §2 plainly.

## 11. Out of scope for this spec

The building agent itself, the prompt/skill design that delivers rules to it, and any comparison experiment over agent variants. Those come after there is something to verify against, and each gets its own spec. This document covers the verifier only.
