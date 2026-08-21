import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { determinant3, isOrthonormal } from "../resolve/matrix.js";
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
const RADIUS_TOL = 0.5;
const AXIS_TOL = 1e-6;

/**
 * B-01 / NO_STUD_IN_PINHOLE.
 *
 * Stricter than the 2006 LEGO presentation (which called a single stud in a
 * Technic hole legal-but-inadvisable): the current BrickLink Designer
 * Program bans it outright. A System stud entering a Technic pinhole is
 * identified here purely from connectivity data -- an edge whose hotspot
 * radius matches the 6 LDU stud radius (within tolerance for the rounding
 * shadow-library `secs=` values carry), landing on a placement in the
 * Technic-hole part class (`data/part-classes.json`, seeded from the
 * corpus's B-01/L-01/L-02/L-03 part lists). No geometry beyond what
 * `buildGraph` already computed is needed.
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

    const out: Finding[] = [];
    for (const e of graph.edges) {
      if (e.radius === undefined || Math.abs(e.radius - STUD_RADIUS) > RADIUS_TOL) continue;
      const pa = model.placements[e.a];
      const pb = model.placements[e.b];
      if (!pa || !pb) continue;

      // One physical connection, one finding. A part like 3700.dat is a
      // Technic-hole part that also carries ordinary studs, so both
      // endpoints of an edge can legitimately be Technic-hole-class at
      // once (two such parts mated normally). Evaluate both orientations
      // to find a match, but report at most one finding for this edge --
      // never one per matching orientation.
      const match = (
        [
          [pa, pb],
          [pb, pa],
        ] as const
      ).find(([, target]) => TECHNIC_HOLE_PARTS.has(target.partId.toLowerCase()));
      if (!match) continue;
      const [source, target] = match;
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
 * A placement's world rotation is axis-aligned (a multiple of 90 degrees on
 * every axis) exactly when every entry of the 3x3 rotation block is 0 or
 * +-1 -- any yaw/pitch/roll that isn't a multiple of 90 degrees necessarily
 * produces at least one fractional (non-0, non-+-1) entry in an orthonormal
 * rotation matrix. `Placement.world` is a row-major flattened Mat4
 * (resolve/matrix.ts), so the rotation block sits at indices
 * 0,1,2 / 4,5,6 / 8,9,10.
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
 * E-01 is independently failing on the same transform.
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

      const det = determinant3(p.world);
      if (Math.abs(det) < AXIS_TOL || !isOrthonormal(p.world, AXIS_TOL)) {
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

      const rot = [
        p.world[0]!,
        p.world[1]!,
        p.world[2]!,
        p.world[4]!,
        p.world[5]!,
        p.world[6]!,
        p.world[8]!,
        p.world[9]!,
        p.world[10]!,
      ];
      const axisAligned = rot.every((v) => Math.abs(v) < AXIS_TOL || Math.abs(Math.abs(v) - 1) < AXIS_TOL);
      if (axisAligned) continue;
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
