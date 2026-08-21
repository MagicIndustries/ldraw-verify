/**
 * OMR precision harness (Task 14).
 *
 * The idea this rests on: the LDraw Official Model Repository (OMR) holds
 * scans of real, released LEGO sets. A released set contains no illegal
 * building technique by construction -- LEGO would not ship one. So every
 * HARD-tier `fail` this tool reports against an OMR model is, by
 * definition, a false positive. Running the verifier over a large OMR
 * sample and counting HARD fails therefore measures each HARD rule's
 * false-positive rate with no hand labelling required. (Caveat: the OMR
 * corpus is itself a fan *reproduction* of a released set, not LEGO's own
 * CAD data, and per its own stated scope is not guaranteed free of
 * unofficial/alternate content -- see the Task 14 report for what was
 * checked and what that means for how to read a small residual rate.)
 *
 * `unimplemented` and `unknown` findings are excluded from both the
 * denominator and the numerator: they are not claims the rule made about
 * the model, so they cannot be false positives (see `applied`/`hardHits`
 * below and src/verify.ts's exitCodeFor, which draws the same line for the
 * same reason).
 *
 * Counting is per MODEL, not per finding: a rule that emits several `fail`
 * findings against one model (e.g. once per bad placement) counts as ONE
 * applicable model with ONE false positive for that rule, not one per
 * finding. The demote/quarantine thresholds below are defined against "what
 * fraction of real models does this rule wrongly reject", which is a
 * per-model question -- counting findings instead let one heavily-affected
 * model (e.g. a rule emitting a finding per placement on a 1900-part set)
 * dominate a rule's whole rate. `applicableFindings`/`falsePositiveFindings`
 * are still recorded on each row alongside the per-model counts precisely so
 * the old (finding-count) and new (model-count) framing can both be reported
 * -- see the Task 14 report.
 *
 * Usage: tsx scripts/omr-precision.ts <dir-of-omr-models> [--shadow-dir <dir>]
 * (or LDCAD_SHADOW_DIR=<dir> in the environment, matching the CLI).
 */
import { readdir, writeFile } from "node:fs/promises";
import { extname, join } from "node:path";
import { verifyFile } from "../src/verify.js";
import type { VerifyOptions } from "../src/verify.js";

const DEMOTE_AT = 0.01;
const QUARANTINE_AT = 0.05;

/**
 * A single OMR model gets this long before the harness gives up on it and
 * moves on. This exists because of a real failure seen while measuring the
 * production corpus (see the Task 14 report): one model wedged `verifyFile`
 * indefinitely -- not a thrown error the surrounding try/catch could catch,
 * but an awaited call that simply never settled, which would otherwise
 * stall the entire run forever on a single bad input. 30s is generous
 * against the ~2-4s a normal model takes (dominated by `LibraryIndex`
 * rebuilding itself from ~26k part files on every `verifyFile` call, not
 * by anything about the model), so a timeout here is a strong signal
 * something is actually wrong with that model or the tool's handling of
 * it, not just a slow but honest scan.
 */
const PER_FILE_TIMEOUT_MS = 30_000;

/** Progress is logged this often so a multi-thousand-model run isn't silent
 * for the better part of an hour with no way to tell a slow-but-healthy
 * scan from a wedged one. */
const PROGRESS_EVERY = 25;

interface PrecisionRow {
  ruleId: string;
  /** Per-model counts -- what the demote/quarantine verdict is computed from. */
  falsePositives: number;
  applicable: number;
  rate: number;
  /** Per-finding counts -- the pre-Task-14 framing, kept for legibility. */
  falsePositiveFindings: number;
  applicableFindings: number;
  findingRate: number;
  verdict: "keep" | "DEMOTE" | "QUARANTINE";
}

interface SkippedModel {
  file: string;
  error: string;
}

function formatDuration(ms: number): string {
  const totalSeconds = Math.round(ms / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return minutes > 0 ? `${minutes}m ${seconds}s` : `${seconds}s`;
}

const omrDir = process.argv[2];
if (!omrDir || omrDir.startsWith("--")) {
  console.error("usage: tsx scripts/omr-precision.ts <dir-of-omr-models> [--shadow-dir <dir>]");
  process.exit(3);
}

// Matches the CLI's own handling (src/cli.ts): under exactOptionalPropertyTypes,
// an optional `shadowDir?: string` may not be assigned `undefined` explicitly --
// the key must be entirely absent when there is no value, rather than present
// with an undefined value. A conditional spread keeps that distinction instead
// of writing `shadowDir: process.env.LDCAD_SHADOW_DIR` the way the original
// sketch for this harness did, which does not type-check here.
const shadowFlagIndex = process.argv.indexOf("--shadow-dir");
const shadowDir = shadowFlagIndex !== -1 ? process.argv[shadowFlagIndex + 1] : process.env.LDCAD_SHADOW_DIR;

const startedAt = Date.now();

const allEntries = await readdir(omrDir);
const files = allEntries.filter((f) => [".ldr", ".mpd"].includes(extname(f).toLowerCase())).sort();

// Per-model counts (the framing the demote/quarantine verdict is computed
// from): how many MODELS each rule rendered an opinion on, and how many of
// those it failed.
const modelsApplicable = new Map<string, number>();
const modelsFailed = new Map<string, number>();
// Per-finding counts (the pre-Task-14 framing, kept for legibility -- see
// the module doc comment).
const findingsApplicable = new Map<string, number>();
const findingsFailed = new Map<string, number>();
const skipped: SkippedModel[] = [];
let scanned = 0;

for (const [i, f] of files.entries()) {
  const verifyOpts: VerifyOptions = {
    libraryRoot: ".cache/ldraw",
    ...(shadowDir !== undefined ? { shadowDir } : {}),
  };

  let result;
  try {
    // See PER_FILE_TIMEOUT_MS's doc comment: a rejection here abandons the
    // `verifyFile` call rather than cancelling it -- Node has no general
    // way to cancel an in-flight async operation -- but that is safe. If
    // the abandoned call eventually does settle, nothing is left awaiting
    // it, so its result (or error) is simply discarded.
    result = await Promise.race([
      verifyFile(join(omrDir, f), verifyOpts),
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error(`timed out after ${PER_FILE_TIMEOUT_MS}ms`)), PER_FILE_TIMEOUT_MS),
      ),
    ]);
  } catch (err) {
    const message = (err as Error).message;
    console.error(`skipped ${f}: ${message}`);
    skipped.push({ file: f, error: message });
    continue;
  }
  scanned++;

  if ((i + 1) % PROGRESS_EVERY === 0 || i + 1 === files.length) {
    console.error(`  ... ${i + 1}/${files.length} (${formatDuration(Date.now() - startedAt)} elapsed)`);
  }

  // Per-model: a rule counts as applicable to THIS model if it rendered an
  // opinion (pass or fail) on at least one finding here, and as a false
  // positive for THIS model if at least one of those findings was a fail --
  // regardless of how many findings it emitted. Tracked per-model via a
  // couple of local Sets so a rule with e.g. 1904 individual bad-placement
  // findings on one model still contributes exactly 1 to that rule's
  // applicable/false-positive counts, not 1904.
  const applicableThisModel = new Set<string>();
  const failedThisModel = new Set<string>();

  for (const finding of result.findings) {
    if (finding.tier !== "HARD") continue;
    // unimplemented/unknown are not a claim about this model -- see the
    // module doc comment. Excluding them from the applicable counts keeps
    // the denominator honest: it is "models/findings this rule actually
    // rendered an opinion on", not "nominally registered for".
    if (finding.status === "unimplemented" || finding.status === "unknown") continue;

    findingsApplicable.set(finding.ruleId, (findingsApplicable.get(finding.ruleId) ?? 0) + 1);
    applicableThisModel.add(finding.ruleId);
    if (finding.status === "fail") {
      findingsFailed.set(finding.ruleId, (findingsFailed.get(finding.ruleId) ?? 0) + 1);
      failedThisModel.add(finding.ruleId);
    }
  }

  for (const ruleId of applicableThisModel) {
    modelsApplicable.set(ruleId, (modelsApplicable.get(ruleId) ?? 0) + 1);
  }
  for (const ruleId of failedThisModel) {
    modelsFailed.set(ruleId, (modelsFailed.get(ruleId) ?? 0) + 1);
  }
}

const durationMs = Date.now() - startedAt;

const rows: PrecisionRow[] = [...modelsApplicable.keys()]
  .map((ruleId) => {
    const hits = modelsFailed.get(ruleId) ?? 0;
    const n = modelsApplicable.get(ruleId) ?? 0;
    const rate = n === 0 ? 0 : hits / n;
    const verdict: PrecisionRow["verdict"] = rate >= QUARANTINE_AT ? "QUARANTINE" : rate >= DEMOTE_AT ? "DEMOTE" : "keep";
    const findingHits = findingsFailed.get(ruleId) ?? 0;
    const findingN = findingsApplicable.get(ruleId) ?? 0;
    return {
      ruleId,
      falsePositives: hits,
      applicable: n,
      rate,
      falsePositiveFindings: findingHits,
      applicableFindings: findingN,
      findingRate: findingN === 0 ? 0 : findingHits / findingN,
      verdict,
    };
  })
  .sort((a, b) => b.rate - a.rate);

console.log(`scanned ${scanned}/${files.length} OMR models (${skipped.length} skipped) in ${formatDuration(durationMs)}\n`);
console.log("per-model (verdict is computed from this):");
for (const r of rows) {
  console.log(`${r.verdict.padEnd(11)} ${r.ruleId.padEnd(6)} ${r.falsePositives}/${r.applicable}  ${(r.rate * 100).toFixed(2)}%`);
}
console.log("\nper-finding (old framing, for comparison -- not what the verdict is computed from):");
for (const r of rows) {
  console.log(
    `${" ".repeat(11)} ${r.ruleId.padEnd(6)} ${r.falsePositiveFindings}/${r.applicableFindings}  ${(r.findingRate * 100).toFixed(2)}%`,
  );
}
if (skipped.length > 0) {
  console.log(`\n${skipped.length} model(s) failed to parse and were excluded from the counts above:`);
  for (const s of skipped) {
    console.log(`  ${s.file}: ${s.error}`);
  }
}

await writeFile(
  "precision-report.json",
  JSON.stringify(
    {
      corpusDir: omrDir,
      generatedAt: new Date(startedAt).toISOString(),
      durationMs,
      totalFiles: files.length,
      scanned,
      skipped,
      demoteAt: DEMOTE_AT,
      quarantineAt: QUARANTINE_AT,
      rows,
    },
    null,
    2,
  ),
);
