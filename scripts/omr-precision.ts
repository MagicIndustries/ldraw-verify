/**
 * OMR precision harness.
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
 * MEASURING EVERY TIER, NOT JUST HARD (final fix wave, item 2)
 * -----------------------------------------------------------
 * This harness previously skipped every finding whose tier was not HARD.
 * That made the demote/quarantine mechanism structurally blind to the
 * DISCOURAGED rules -- which were the worst-behaved ones on the branch:
 * measured over 24 random OMR models, E-04 failed 24/24, E-02 24/24, E-07
 * 23/24. Since a DISCOURAGED `fail` is what produces exit code 2
 * (src/verify.ts's `exitCodeFor`), the tool exited nonzero on 100% of real
 * released sets while its own precision harness reported nothing wrong.
 * A harness that cannot see the tier responsible for the failure mode it
 * exists to catch is not a harness.
 *
 * HARD and DISCOURAGED are counted with the same arithmetic but reported
 * and judged SEPARATELY, because a fail means something different in each:
 *
 * - HARD is "stresses or damages an element; never emit, reject and
 *   re-plan". A real released set cannot contain one, so a HARD fail on an
 *   OMR model IS a false positive, and DEMOTE_AT/QUARANTINE_AT apply as
 *   before.
 *
 * - DISCOURAGED is "works but is out-of-system, fragile, or degrades; emit
 *   only with a stated reason". Real released sets legitimately DO
 *   out-of-system things -- E-07 (references a `~Moved to` alias) fires on
 *   nearly every real set because nearly every real set genuinely does
 *   reference a superseded part number, authored when that number was
 *   current. Those are TRUE positives. So a high DISCOURAGED rate is not
 *   evidence the predicate is wrong, and demoting or quarantining a rule
 *   for it would be weakening a predicate to make a number fall.
 *
 *   What a near-universal DISCOURAGED rate IS evidence of: that the rule
 *   has no discriminating power as a GATE. A signal present on ~100% of
 *   legitimate input cannot separate good input from bad, so it must be
 *   read as advisory annotation, never as a rejection -- and anything
 *   gating automation on a nonzero exit code needs to know that before it
 *   sees it. Such rules are flagged `NON-DISCRIMINATING` below (see
 *   `NON_DISCRIMINATING_AT`) and disclosed in the README with their
 *   measured rate. They are NOT retiered, deleted, or silenced.
 *
 * The per-model exit-code distribution is reported alongside, because that
 * is the number an integrator actually experiences, and no per-rule rate
 * makes it visible on its own.
 *
 * `unimplemented` and `unknown` findings are excluded from both the
 * denominator and the numerator: they are not claims the rule made about
 * the model, so they cannot be false positives (see src/verify.ts's
 * exitCodeFor, which draws the same line for the same reason).
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
 * the old (finding-count) and new (model-count) framing can both be reported.
 *
 * Usage:
 *   tsx scripts/omr-precision.ts <dir-of-omr-models> [--shadow-dir <dir>]
 *                                [--every N] [--limit N] [--offset N]
 * (or LDCAD_SHADOW_DIR=<dir> in the environment, matching the CLI.)
 *
 * `--every N` takes every Nth file from the sorted listing, `--offset N`
 * shifts where that stride starts, and `--limit N` caps the count. A run's
 * sample rule is echoed to stdout and recorded in precision-report.json, so
 * a reported rate always carries the sample it was measured over instead of
 * being quoted as if it covered the whole corpus.
 */
import { readdir, writeFile } from "node:fs/promises";
import { extname, join } from "node:path";
import { verifyFile } from "../src/verify.js";
import type { VerifyOptions } from "../src/verify.js";
import type { Tier } from "../src/rules/types.js";

const DEMOTE_AT = 0.01;
const QUARANTINE_AT = 0.05;

/**
 * Per-model rate at or above which a DISCOURAGED rule is reported as
 * NON-DISCRIMINATING: it fires on essentially every real, legal set, so
 * its presence says nothing about whether a given model is unusual. See
 * this module's doc comment for why that is a statement about the rule's
 * value as a gate and NOT a claim that its predicate is wrong.
 */
const NON_DISCRIMINATING_AT = 0.95;

/**
 * A single OMR model gets this long before the harness gives up on it and
 * moves on. This exists because of a real failure seen while measuring the
 * production corpus (see the Task 14 report): one model wedged `verifyFile`
 * indefinitely -- not a thrown error the surrounding try/catch could catch,
 * but an awaited call that simply never settled, which would otherwise
 * stall the entire run forever on a single bad input. 30s is generous
 * against the ~2-4s a normal model takes (the ~26k-file `LibraryIndex`
 * scan is now built once per process and shared -- see
 * `LibraryIndex.fromDirectory` -- so per-model time is the model's own
 * parse, resolve and connectivity walk), so a timeout here is a strong signal
 * something is actually wrong with that model or the tool's handling of
 * it, not just a slow but honest scan.
 */
const PER_FILE_TIMEOUT_MS = 30_000;

/** Progress is logged this often so a multi-thousand-model run isn't silent
 * for the better part of an hour with no way to tell a slow-but-healthy
 * scan from a wedged one. */
const PROGRESS_EVERY = 25;

/** Tiers this harness renders a verdict on. STYLE/LEGAL entries never
 * produce a `fail` -- the registry reports them as `informational` -- so
 * there is nothing to measure for them. */
const MEASURED_TIERS: Tier[] = ["HARD", "DISCOURAGED"];

interface PrecisionRow {
  ruleId: string;
  tier: Tier;
  /** Per-model counts -- what the demote/quarantine verdict is computed from. */
  falsePositives: number;
  applicable: number;
  rate: number;
  /** Per-finding counts -- the pre-Task-14 framing, kept for legibility. */
  falsePositiveFindings: number;
  applicableFindings: number;
  findingRate: number;
  /**
   * HARD rules get "keep"/"DEMOTE"/"QUARANTINE" -- a judgement on a
   * measured FALSE-POSITIVE rate, since a real released set cannot contain
   * a HARD violation. DISCOURAGED rules get
   * "keep"/"NON-DISCRIMINATING" -- a judgement on how much the signal
   * separates anything, since a real released set legitimately CAN contain
   * a DISCOURAGED technique and those fails may be entirely true. The two
   * vocabularies are deliberately distinct so a DISCOURAGED row can never
   * be read as "this rule is wrong that often".
   */
  verdict: "keep" | "DEMOTE" | "QUARANTINE" | "NON-DISCRIMINATING";
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
  console.error(
    "usage: tsx scripts/omr-precision.ts <dir-of-omr-models> [--shadow-dir <dir>] [--every N] [--offset N] [--limit N]",
  );
  process.exit(3);
}

/**
 * Reads a positive-integer flag, rejecting a missing or non-numeric value
 * loudly instead of silently falling back to a default -- a sample rule
 * that quietly differs from the one the operator typed would make every
 * rate in the report describe an unknown sample.
 */
function intFlag(name: string, fallback: number, min = 1): number {
  const at = process.argv.indexOf(name);
  if (at === -1) return fallback;
  const raw = process.argv[at + 1];
  const value = Number(raw);
  if (raw === undefined || !Number.isInteger(value) || value < min) {
    console.error(`${name} needs an integer >= ${min}, got: ${raw ?? "(nothing)"}`);
    process.exit(3);
  }
  return value;
}

const sampleEvery = intFlag("--every", 1);
const sampleOffset = intFlag("--offset", 0, 0);
const sampleLimit = intFlag("--limit", Number.MAX_SAFE_INTEGER);

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
const corpusFiles = allEntries.filter((f) => [".ldr", ".mpd"].includes(extname(f).toLowerCase())).sort();

/**
 * English ordinal suffix for a positive integer. The obvious `n % 10`
 * switch is wrong on its own -- 11/12/13 take "th", not "st"/"nd"/"rd",
 * because the 11-13 exception is keyed off `n % 100`, not `n % 10`. A
 * three-way ternary on the exact values 1/2/3 (this function's previous
 * form) also gets it wrong for every value above 3 that isn't already
 * excluded by the "every 1st" special case above: 21 % 10 == 1 but 21 is
 * not one of {1,2,3}, so it fell through to the "th" default and printed
 * "21th"/"22th"/"23th" instead of "21st"/"22nd"/"23rd".
 */
function ordinalSuffix(n: number): string {
  const mod100 = n % 100;
  if (mod100 >= 11 && mod100 <= 13) return "th";
  switch (n % 10) {
    case 1:
      return "st";
    case 2:
      return "nd";
    case 3:
      return "rd";
    default:
      return "th";
  }
}

// The sample is a deterministic stride over the sorted listing, not a
// random draw: quoting a rate without being able to reproduce the exact
// sample it came from is how a measured number turns into folklore.
const sampleRule =
  sampleEvery === 1 && sampleLimit === Number.MAX_SAFE_INTEGER
    ? "every model in the directory"
    : `every ${sampleEvery}${ordinalSuffix(sampleEvery)} file by sorted name` +
      (sampleOffset > 0 ? `, starting at offset ${sampleOffset}` : "") +
      (sampleLimit === Number.MAX_SAFE_INTEGER ? "" : `, capped at ${sampleLimit}`);
const files = corpusFiles.filter((_, i) => i >= sampleOffset && (i - sampleOffset) % sampleEvery === 0).slice(0, sampleLimit);
console.error(`sample: ${files.length} of ${corpusFiles.length} models (${sampleRule})`);

// Per-model counts (the framing the demote/quarantine verdict is computed
// from): how many MODELS each rule rendered an opinion on, and how many of
// those it failed.
const modelsApplicable = new Map<string, number>();
const modelsFailed = new Map<string, number>();
// Per-finding counts (the pre-Task-14 framing, kept for legibility -- see
// the module doc comment).
const findingsApplicable = new Map<string, number>();
const findingsFailed = new Map<string, number>();
/** Each measured rule's tier, taken from the findings themselves (the
 * registry stamps the corpus tier on every finding), so a re-tiering in
 * the corpus shows up in the report without touching this script. */
const tierOf = new Map<string, Tier>();
/**
 * How many models earned each exit code. This is the number an integrator
 * actually experiences, and it is not derivable from the per-rule rates:
 * one rule at 100% is enough to make the whole tool's exit code useless,
 * and nothing in a per-rule table says so out loud.
 */
const exitCodes = new Map<number, number>();
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

  exitCodes.set(result.exitCode, (exitCodes.get(result.exitCode) ?? 0) + 1);

  for (const finding of result.findings) {
    // Every tier that can produce a `fail` is measured, not just HARD --
    // see this module's doc comment for why the HARD-only filter that used
    // to sit here made the whole harness blind to the branch's actual
    // failure mode.
    if (!MEASURED_TIERS.includes(finding.tier)) continue;
    tierOf.set(finding.ruleId, finding.tier);
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
    const tier = tierOf.get(ruleId) ?? "HARD";
    // Two vocabularies, deliberately: see PrecisionRow.verdict. A
    // DISCOURAGED rule is never DEMOTEd or QUARANTINEd off a rate, because
    // its fails on a real set may all be true.
    const verdict: PrecisionRow["verdict"] =
      tier === "HARD"
        ? rate >= QUARANTINE_AT
          ? "QUARANTINE"
          : rate >= DEMOTE_AT
            ? "DEMOTE"
            : "keep"
        : rate >= NON_DISCRIMINATING_AT
          ? "NON-DISCRIMINATING"
          : "keep";
    const findingHits = findingsFailed.get(ruleId) ?? 0;
    const findingN = findingsApplicable.get(ruleId) ?? 0;
    return {
      ruleId,
      tier,
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

function printTable(tier: Tier, heading: string): void {
  const tierRows = rows.filter((r) => r.tier === tier);
  console.log(`\n${heading}`);
  if (tierRows.length === 0) {
    console.log("  (no rule at this tier rendered an opinion on any model in the sample)");
    return;
  }
  for (const r of tierRows) {
    console.log(
      `${r.verdict.padEnd(19)} ${r.ruleId.padEnd(6)} ${String(r.falsePositives).padStart(4)}/${String(r.applicable).padEnd(4)} ` +
        `${(r.rate * 100).toFixed(2).padStart(6)}%   (findings ${r.falsePositiveFindings}/${r.applicableFindings})`,
    );
  }
}

console.log(`scanned ${scanned}/${files.length} sampled OMR models (${skipped.length} skipped) in ${formatDuration(durationMs)}`);
console.log(`sample: ${files.length} of ${corpusFiles.length} corpus models -- ${sampleRule}\n`);

printTable(
  "HARD",
  "HARD tier -- a fail on a real released set IS a false positive (verdict: keep / DEMOTE >= 1% / QUARANTINE >= 5%):",
);
printTable(
  "DISCOURAGED",
  "DISCOURAGED tier -- a fail on a real released set may be TRUE (real sets do out-of-system things).\n" +
    "The rate measures discriminating power as a gate, not correctness (NON-DISCRIMINATING >= 95%):",
);

// The number an integrator actually experiences. Printed last because it
// is the summary the per-rule tables exist to explain.
console.log("\nper-model exit code (0 = clean, 1 = HARD fail, 2 = DISCOURAGED fail only):");
for (const code of [0, 1, 2, 3]) {
  const n = exitCodes.get(code) ?? 0;
  if (n === 0 && code === 3) continue;
  console.log(`  exit ${code}: ${n}/${scanned}  ${scanned === 0 ? "" : `${((n / scanned) * 100).toFixed(2)}%`}`);
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
      corpusFiles: corpusFiles.length,
      sampleRule,
      sampledFiles: files.length,
      totalFiles: files.length,
      scanned,
      skipped,
      demoteAt: DEMOTE_AT,
      quarantineAt: QUARANTINE_AT,
      nonDiscriminatingAt: NON_DISCRIMINATING_AT,
      exitCodes: Object.fromEntries([...exitCodes.entries()].sort((a, b) => a[0] - b[0])),
      rows,
    },
    null,
    2,
  ),
);
