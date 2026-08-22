import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import {
  applyDir,
  AXIS_ALIGNED_ENTRY_EPS,
  determinant3,
  isAxisAligned,
  isAxisAlignedDirection,
  isOrthonormal,
  ORTHONORMALITY_EPS,
  SINGULAR_DET_EPS,
} from "../resolve/matrix.js";
import type { Edge } from "../connect/graph.js";
import type { Finding, Rule, RuleContext } from "./types.js";

/**
 * `data/part-classes.json` lives at the repo root, not under `src/`, so it
 * is not on any module-resolution path -- it has to be read from disk
 * directly. The task-12 brief's original snippet did that with
 * `readFileSync("data/part-classes.json", ...)`, a path relative to
 * `process.cwd()`. That breaks the moment this module is imported from a
 * process whose working directory isn't the repo root (e.g. `vitest` run
 * from a subdirectory, or this package consumed as a dependency) -- an
 * entirely plausible way to invoke a test runner or CLI, not an edge case.
 *
 * Resolving relative to `import.meta.url` instead ties the path to where
 * this module itself lives on disk, which is cwd-independent. This file is
 * `src/rules/l5-legality.ts`, two directories below the repo root, so `../
 * ../data/part-classes.json` from here lands on `data/part-classes.json` at
 * the root, regardless of where the process was launched from.
 *
 * The same relative depth also holds once this module is compiled: `tsc`
 * (rootDir `.`, outDir `dist`) mirrors the whole source tree, so this file
 * lands at `dist/src/rules/l5-legality.js` -- two directories below
 * `dist/`, exactly as `src/rules/l5-legality.ts` is two directories below
 * the repo root. `../../data/part-classes.json` therefore resolves to
 * `dist/data/part-classes.json` from the compiled module, unchanged from
 * the source-layout formula above, as long as the build copies the data
 * file to that mirrored location -- see the `build` script in
 * `package.json`.
 */
const DATA_PATH = fileURLToPath(new URL("../../data/part-classes.json", import.meta.url));

interface PartClasses {
  technicHole: string[];
}

/**
 * `TECHNIC_HOLE_PARTS` is populated lazily, on first use by a rule that
 * actually needs it, not at module load. Loading eagerly at module scope
 * means *merely importing* this module -- which happens transitively
 * through any barrel or entry point that pulls in the L5 rules, whether or
 * not a caller ever runs B-01 -- throws an uncaught `ENOENT` and crashes
 * the whole process if `data/part-classes.json` isn't where `DATA_PATH`
 * expects it (e.g. a `dist/` build where the copy step that ships it
 * alongside the compiled output was skipped or misconfigured). Deferring
 * the read until a rule actually runs turns that mistake into an ordinary
 * error surfaced inside `Rule.run` instead of one that takes the process
 * down before it can do anything at all.
 *
 * The exported binding keeps the same `Set<string>` shape existing callers
 * and tests already rely on -- same object identity for the process's
 * whole life, just empty until `ensureTechnicHolePartsLoaded` fills it in
 * on first real use.
 */
export const TECHNIC_HOLE_PARTS = new Set<string>();
let technicHolePartsLoaded = false;

function ensureTechnicHolePartsLoaded(): void {
  if (technicHolePartsLoaded) return;
  technicHolePartsLoaded = true;
  const classes = JSON.parse(readFileSync(DATA_PATH, "utf8")) as PartClasses;
  for (const id of classes.technicHole) TECHNIC_HOLE_PARTS.add(id.toLowerCase());
}

const STUD_RADIUS = 6;
/** Tolerance on a hotspot's `secs=` radius in LDU -- shadow-library values
 * are rounded, so a nominal 6 LDU stud can read slightly off. A physical
 * length, unrelated to any matrix tolerance. */
const STUD_RADIUS_TOL = 0.5;

/**
 * B-01 / NO_STUD_IN_PINHOLE.
 *
 * Stricter than the 2006 LEGO presentation (which called a single stud in a
 * Technic hole legal-but-inadvisable): the current BrickLink Designer
 * Program bans it outright. A System stud entering a Technic pinhole is
 * identified here from connectivity data -- an edge whose hotspot radius
 * matches the 6 LDU stud radius (within tolerance for the rounding
 * shadow-library `secs=` values carry), landing on a placement in the
 * Technic-hole part class (`data/part-classes.json`, seeded from the
 * corpus's B-01/L-01/L-02/L-03 part lists).
 *
 * Radius and part-class alone are not enough, though: every real
 * Technic-hole-class part (3700, 3701, 3702, 3894, 6541, 32000 -- all the
 * "Technic Brick ... with Holes" family) carries BOTH a genuine Technic
 * through-hole (in the real shadow library, `SNAP_INCL [ref=connhole.dat]`,
 * `caps=none`) AND an entirely separate, ordinary blind anti-stud tube for
 * normal top/bottom System stacking (`SNAP_CYL [gender=F] [caps=one] [secs=S
 * 6 4]`), at the *same* nominal 6 LDU radius -- that's why a Technic hole
 * can physically accept a stud at all. Matching on radius and part-class
 * alone therefore flags perfectly ordinary "plate stacked on top of a
 * Technic brick" connections as if they were a stud jammed into the side
 * pinhole: measured against the real OMR corpus, this made B-01 fail on
 * ~89% of real, legally-built released sets (see the Task 14 report), all
 * traced to this exact ordinary-stacking edge.
 *
 * `caps=` is the shadow library's own signal for the distinction: `none`
 * means open at both ends (a genuine through-hole a stud can be jammed
 * into), `one` means closed at one end (a blind socket -- stud or
 * anti-stud tube, either way not a pinhole). `Edge.femaleCaps` carries that
 * value read specifically off the female side of the pairing (see its doc
 * comment in connect/graph.ts for why radius-style either-side fallback
 * would hide it), so this rule only flags an edge whose female side is
 * confirmed `caps=none` -- an edge with no caps data at all is left
 * unflagged rather than guessed at, per this tool's "never fabricate a
 * verdict it can't support" principle.
 *
 * `caps=none` alone still over-reaches, though: every Technic axle and pin
 * checked in the real shadow library ALSO reports a stud-radius male
 * `SNAP_CYL` hotspot (e.g. 3706.dat "Technic Axle 6", 6558.dat "Technic Pin
 * Long with Friction and Slot") -- and inserting an axle or pin into a
 * Technic through-hole is the intended, ordinary use of that hole, not the
 * "System stud in a pinhole" violation this rule names. What every such
 * axle/pin carries, and no genuine System stud primitive
 * (`p/stud.dat`/`p/stud2.dat`/...) does, is `[slide=true]` -- LDCad's own
 * marker for "this connector slides/rotates along its axis inside its
 * mate". `Edge.maleSlide` carries that off the male side specifically
 * (mirroring `femaleCaps`'s female-side read), and this rule excludes any
 * edge where it's set.
 */
const noStudInPinhole: Rule = {
  id: "B-01",
  needs: ["graph", "placements"],
  run({ model, meta }: RuleContext): Finding[] {
    const graph = model.graph;
    // Defensive only -- the registry's `needs` gate keeps this from firing
    // without a graph in normal use (see l4-connectivity.ts's B-06 for the
    // same reasoning), but an empty array here would synthesize to `pass`
    // per the registry contract, which would misreport "never checked" as
    // "known clear". Since `needs` already includes "graph", a direct
    // caller that bypasses the registry gets an honest `unknown` instead.
    if (!graph) {
      return [
        {
          ruleId: meta.id,
          tier: meta.tier,
          status: "unknown",
          message: "no connectivity graph was computed for this model; Technic-hole occupancy is not decidable",
          locations: [],
        },
      ];
    }

    ensureTechnicHolePartsLoaded();

    // One physical connection can surface as several edges: a Technic pin in
    // a hole yields three, and only one of them carries `slide=true`. Reading
    // `maleSlide` off a single edge therefore misses the evidence sitting on
    // its own duplicates, and a correctly seated pin gets reported as a stud
    // in a pinhole. Group edges by the pair they join and where they join it,
    // so the sliding evidence applies to the whole connection.
    const connections = new Map<string, { edges: Edge[]; sliding: boolean }>();
    for (const e of graph.edges) {
      const key = `${e.female}|${e.male}|${e.at.map((v) => Math.round(v)).join(",")}`;
      const group = connections.get(key) ?? { edges: [], sliding: false };
      group.edges.push(e);
      group.sliding ||= e.maleSlide === true;
      connections.set(key, group);
    }

    const out: Finding[] = [];
    for (const { edges, sliding } of connections.values()) {
      // Read the radius off the MALE side specifically. `Edge.radius` falls
      // back to whichever side carried a value, so a stud-sized reading there
      // may be describing the socket rather than the plug -- in set 1682-1 a
      // wheel rim whose only male connector is its r=38 tyre seat was called
      // a System stud on the strength of the pinhole's 6. Every genuine
      // System stud primitive carries its own r=6, so requiring the male's
      // own radius costs no true positives; a male with no radius data at all
      // is left unflagged rather than guessed at.
      const e = edges.find(
        (x) => x.maleRadius !== undefined && Math.abs(x.maleRadius - STUD_RADIUS) <= STUD_RADIUS_TOL,
      );
      if (!e) continue;
      // Only a confirmed through-hole (caps=none) is a pinhole a stud can be
      // jammed into -- caps=one (the common case: an ordinary stud or blind
      // anti-stud tube) and missing caps data are both left unflagged. See
      // this rule's doc comment.
      if (e.femaleCaps !== "none") continue;
      // A sliding male connector is an axle/pin, not a System stud -- seating
      // one in a Technic hole is the ordinary, intended use of that hole.
      // See this rule's doc comment.
      if (sliding) continue;
      // The socket and the plug, not merely "the two parts that met". Asking
      // whether EITHER endpoint is a Technic-hole part conflates "this part
      // has a hole somewhere" with "the hole is what is connected here", and
      // those come apart constantly: `caps=none` describes any opening with
      // no closed end, so a hollow stud, a round-brick barrel and a cone bore
      // all report it just as a Technic pinhole does. Stack a hollow-stud
      // round brick on a Technic brick and the round brick supplies the
      // `caps=none` female while the Technic brick supplies an ordinary top
      // stud -- the old test blamed the Technic brick's pinhole, which sits
      // ten LDU away and is not party to the connection. Requiring the
      // Technic-hole part to be the FEMALE endpoint is what makes the claim
      // "a stud is in this part's hole" actually true.
      const target = model.placements[e.female];
      const source = model.placements[e.male];
      if (!target || !source) continue;
      if (!TECHNIC_HOLE_PARTS.has(target.partId.toLowerCase())) continue;
      out.push({
        ruleId: meta.id,
        tier: meta.tier,
        status: "fail",
        message: `stud from ${source.partId} enters a Technic pinhole on ${target.partId}; the BrickLink Designer Program bans this outright`,
        locations: [
          { file: source.file, line: source.line, partId: source.partId },
          { file: target.file, line: target.line, partId: target.partId },
        ],
        evidence: { at: e.at, radius: e.radius },
      });
    }
    return out;
  },
};

/**
 * B-05 / NO_FRACTIONAL_ROTATION.
 *
 * "Single-stud part" is read off `ConnectionGraph.singleStudParts`
 * (`buildGraph`, connect/graph.ts): with grid expansion working, a 1x1
 * plate/tile resolves to exactly one male hotspot, which is what makes this
 * derivable from connectivity data rather than a hand-maintained part list.
 *
 * A placement's rotation is axis-aligned (a multiple of 90 degrees on
 * every axis) exactly when every entry of the 3x3 rotation block is 0 or
 * +-1 -- any yaw/pitch/roll that isn't a multiple of 90 degrees necessarily
 * produces at least one fractional (non-0, non-+-1) entry in an orthonormal
 * rotation matrix. A `Mat4` is row-major and flattened
 * (resolve/matrix.ts), so the rotation block sits at indices
 * 0,1,2 / 4,5,6 / 8,9,10.
 *
 * WHICH MATRIX: `Placement.local`, not `Placement.world`. This rule asks
 * whether a part is square to the assembly it belongs to. Reading the
 * composed world transform instead asks whether it is square to the WORLD,
 * which is a strictly stronger claim that every part of every deliberately
 * tilted sub-assembly violates -- an angled roof section, a train bogie
 * following curved track, a rotated decorative module, all routine in real
 * released sets, and all of them internally detented perfectly. Measured
 * against the real OMR corpus, that was a large share of this rule's
 * false positives: parts as ordinary as a 1x1 brick were failed for
 * sitting inside a submodel someone had rotated. `local` is exactly the
 * matrix the author wrote on the part's own line, which is where a
 * sub-detent rotation would actually be expressed.
 *
 * That per-entry check is only sound when the rotation block is actually an
 * orthonormal rotation to begin with. A degenerate transform -- e.g. a
 * duplicated row, giving `det3 == 0` -- can have every one of those nine
 * entries in {0, 1} and sail through the per-entry check as "aligned" even
 * though it isn't a rotation at all. `E-01` (l2-matrix.ts) is the rule that
 * reports a singular or non-orthonormal transform as a failure, but
 * `Registry.run` evaluates every corpus rule independently against the same
 * model: E-01 failing a placement does not gate B-05 from evaluating that
 * same transform, so B-05 cannot rely on E-01 having already rejected it.
 * `determinant3`/`isOrthonormal` (resolve/matrix.ts) gate the per-entry
 * check below; when they say the rotation isn't well-formed, B-05 reports
 * `unknown` rather than `pass` -- it genuinely cannot tell whether the
 * placement is axis-aligned, and `pass` would claim the opposite of what
 * E-01 is independently failing on the same transform. That gate runs at
 * `ORTHONORMALITY_EPS`, the same value E-01 uses, so the two rules can no
 * longer disagree about whether one matrix is well-formed; the per-entry
 * test itself is the shared `isAxisAligned` at `AXIS_ALIGNED_ENTRY_EPS`,
 * not a local copy of its body.
 *
 * WHICH PARTS IT IS A CLAIM ABOUT
 * -------------------------------
 * `singleStudParts` says a part is held by one stud. It does NOT say that
 * "which way is it turned" is a question with an answer, and for a large
 * class of real parts it isn't. Measured against the real OMR corpus (24
 * models, every 61st file), 42 of this rule's 46 findings were parts whose
 * yaw is either unmeasurable or physically free. Two exemptions, both
 * derived from the shadow library's own connectivity data rather than from
 * a hand-written part list, cover that class:
 *
 * (1) ROTATIONALLY SYMMETRIC PARTS ARE OUT OF SCOPE ENTIRELY.
 *     `ConnectionGraph.rotationallySymmetricParts` (derived by
 *     `rotationallySymmetricAxis`, connect/hotspots.ts) names the parts
 *     whose every connector is round, coaxial, and on one line: a round 1x1
 *     plate, a minifig head, a cone, a plant stem, a Technic pin. Turn one
 *     about that line and nothing moves. This rule's own predicate is "yaw
 *     mod 90 == 0", and for these parts yaw is not a quantity -- so the
 *     rule makes NO claim about them, at any rotation, rather than a claim
 *     it cannot support. That is a scope statement about a class of part,
 *     which is the only kind of exemption this rule accepts; it is not a
 *     tolerance widened until findings stopped appearing.
 *
 *     The consequence is deliberate and worth stating: a round 1x1 plate
 *     whose stud axis has been TILTED off the grid is also exempt, while a
 *     slope brick tilted the same way is not. The difference is not the
 *     tilt, it is that the slope brick's rotation is measurable at all. A
 *     tilted symmetric part is a claim about where its axis points, which
 *     is a different rule from this one (and one nothing in this corpus
 *     currently states); a part that is asymmetric is one this rule can
 *     still measure, and it stays measured. `3040b` and `6091` -- the two
 *     genuine violations in the corpus sample -- are asymmetric (both carry
 *     square `S`-section anti-studs 20 LDU off their stud axis) and keep
 *     failing.
 *
 * (2) A FREE-ROTATION CONNECTOR PERMITS ANY ANGLE ABOUT ITS OWN AXIS.
 *     `ConnectionGraph.freeRotationAxes` names, per placement and in the
 *     part's own frame, the axes of any hinge finger, ball joint or round
 *     sliding shaft the part carries (see `freeRotationAxes` in
 *     connect/hotspots.ts). A part hung on such a joint is set to whatever
 *     angle the joint is turned to, so its rotation is legitimate exactly
 *     when it is a free turn about that axis on top of an ordinary detent.
 *
 *     That condition is checkable, and it is checked rather than assumed:
 *     for a joint axis `a` that is itself a grid direction in the part's
 *     own frame, `R` decomposes as (free turn about the world joint axis) x
 *     (detent) if and only if `R * a` is also a grid direction. (If
 *     `R * a == A * a` for some detent `A`, then `A^-1 R` fixes `a`, so it
 *     is a rotation about `a`; the converse is immediate.) Both halves of
 *     that precondition are tested, not assumed -- a joint axis authored
 *     off-grid inside its own part cannot support the decomposition, and
 *     that case declines the exemption rather than guessing at it.
 *     Unlike (1) this is a per-placement test, and
 *     necessarily so -- a hinge frees one axis, not the part. A hinge plate
 *     yawed about the vertical while its hinge axis lies horizontal is NOT
 *     exempted by this, and is not meant to be: its yaw comes from whatever
 *     its studs are seated in, not from its hinge.
 */
const noFractionalRotation: Rule = {
  id: "B-05",
  needs: ["graph", "placements"],
  run({ model, meta }: RuleContext): Finding[] {
    const graph = model.graph;
    if (!graph || !graph.singleStudParts) {
      return [
        {
          ruleId: meta.id,
          tier: meta.tier,
          status: "unknown",
          message: "single-stud parts cannot be identified without connectivity data",
          locations: [],
        },
      ];
    }

    const out: Finding[] = [];
    for (const i of graph.singleStudParts) {
      const p = model.placements[i];
      if (!p) continue;

      // Exemption (1): the part has no measurable yaw at all. Checked
      // before the well-formedness gate below, because a rule that makes
      // no claim about a part should not report `unknown` about it either
      // -- "I cannot tell" is still a statement about a question, and for
      // these parts there is no question. See this rule's doc comment.
      if (graph.rotationallySymmetricParts?.has(i)) continue;

      // Well-formedness first, at E-01's OWN tolerance. This rule used to
      // ask the same question at 1e-6 -- the value l2-matrix.ts had already
      // measured as unrealistic for real files -- and then say the matrix
      // was "singular or sheared -- see E-01" about placements E-01 passes
      // cleanly. Two rules contradicting each other about one matrix is
      // worse than either verdict alone, so both now read
      // `ORTHONORMALITY_EPS` from src/resolve/matrix.ts.
      const det = determinant3(p.local);
      if (Math.abs(det) < SINGULAR_DET_EPS || !isOrthonormal(p.local, ORTHONORMALITY_EPS)) {
        out.push({
          ruleId: meta.id,
          tier: meta.tier,
          status: "unknown",
          message: `${p.partId}'s rotation is not a well-formed orthonormal matrix (singular or sheared); axis-alignment cannot be determined here -- see E-01`,
          locations: [{ file: p.file, line: p.line, partId: p.partId }],
          evidence: { determinant: det },
        });
        continue;
      }

      // The per-entry 90-degree-multiple test itself is the shared
      // `isAxisAligned` helper (src/resolve/matrix.ts), not a private
      // re-implementation of its body -- which is what this rule carried
      // before, at its own tolerance, and is exactly the drift that
      // centralising `expandGrid` was meant to prevent. Reached only for a
      // matrix already confirmed well-formed above, so a `false` here can
      // only mean "a genuine rotation, but not a multiple of 90 degrees".
      if (isAxisAligned(p.local, AXIS_ALIGNED_ENTRY_EPS)) continue;

      // Exemption (2): a joint the part carries permits free rotation about
      // one of its own axes, and this placement's rotation is exactly such
      // a free turn (it carries that axis to a grid direction). Evaluated
      // here, after the well-formedness gate, because `applyDir` on a
      // sheared or singular matrix would not preserve the axis's length and
      // `isAxisAlignedDirection` assumes a unit vector. See this rule's doc
      // comment for why this one is per-placement while (1) is per-part.
      const freeAxes = graph.freeRotationAxes?.get(i) ?? [];
      if (
        freeAxes.some(
          (a) =>
            isAxisAlignedDirection(a, AXIS_ALIGNED_ENTRY_EPS) &&
            isAxisAlignedDirection(applyDir(p.local, a), AXIS_ALIGNED_ENTRY_EPS),
        )
      ) {
        continue;
      }

      const rot = [
        p.local[0]!,
        p.local[1]!,
        p.local[2]!,
        p.local[4]!,
        p.local[5]!,
        p.local[6]!,
        p.local[8]!,
        p.local[9]!,
        p.local[10]!,
      ];
      out.push({
        ruleId: meta.id,
        tier: meta.tier,
        status: "fail",
        message: `${p.partId} is a single-stud part placed at a non-axis-aligned rotation; sub-detent positioning is not permitted`,
        locations: [{ file: p.file, line: p.line, partId: p.partId }],
        evidence: { rotation: rot },
      });
    }
    return out;
  },
};

export const l5Rules: Rule[] = [noStudInPinhole, noFractionalRotation];
