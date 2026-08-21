import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
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
 */
const DATA_PATH = fileURLToPath(new URL("../../data/part-classes.json", import.meta.url));

interface PartClasses {
  technicHole: string[];
}

function loadTechnicHoleParts(): Set<string> {
  const classes = JSON.parse(readFileSync(DATA_PATH, "utf8")) as PartClasses;
  return new Set(classes.technicHole.map((s) => s.toLowerCase()));
}

export const TECHNIC_HOLE_PARTS = loadTechnicHoleParts();

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

    const out: Finding[] = [];
    for (const e of graph.edges) {
      if (e.radius === undefined || Math.abs(e.radius - STUD_RADIUS) > RADIUS_TOL) continue;
      for (const [self, other] of [
        [e.a, e.b],
        [e.b, e.a],
      ] as const) {
        const source = model.placements[self];
        const target = model.placements[other];
        if (!source || !target) continue;
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
