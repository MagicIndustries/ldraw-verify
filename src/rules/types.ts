import type { LibraryIndex } from "../library/index.js";
import type { Vec3 } from "../parse/ast.js";
import type { ResolvedModel } from "../resolve/ir.js";

export type Tier = "HARD" | "DISCOURAGED" | "STYLE" | "LEGAL";
export type Status = "pass" | "fail" | "unknown" | "unimplemented" | "informational";
export type Need = "placements" | "graph" | "library" | "document";

export interface Location {
  file: string;
  line: number;
  partId?: string;
  world?: Vec3;
}

export interface Finding {
  ruleId: string;
  tier: Tier;
  status: Status;
  message: string;
  locations: Location[];
  evidence?: Record<string, unknown>;
}

export interface RuleMeta {
  id: string;
  name: string;
  tier: Tier;
  statement: string;
  check?: string;
}

export interface RuleContext {
  model: ResolvedModel;
  library: LibraryIndex;
  meta: RuleMeta;
}

export interface Rule {
  id: string;
  needs: Need[];
  run(ctx: RuleContext): Finding[];
}

export interface VerifyResult {
  findings: Finding[];
  coverage: number;
  exitCode: 0 | 1 | 2 | 3;
}

/**
 * Severity ordering for `Status`, most severe first.
 *
 * A rule's predicate may legitimately return several findings for one run —
 * one per part placement, for example — and those findings may carry
 * different statuses (a `fail` for a sheared matrix here, a `pass` note for
 * a mirrored placement there). `ruleOutcome` reduces that set to the single
 * outcome a consumer (a summary line, an exit code, a badge) can report for
 * the rule as a whole.
 *
 * The ordering below is deliberately the worst-thing-wins rule: an outcome
 * must never be reported as better than the worst thing actually observed.
 * A rule with 99 passing placements and 1 sheared one is not "mostly fine" —
 * it is failing, so `fail` outranks everything. Short of an outright
 * failure, `unknown` (a predicate that could not be trusted to evaluate
 * cleanly) and `unimplemented` (never evaluated at all) both mean "we do not
 * actually know whether this holds", which is more dangerous to overstate as
 * `pass` than to report cautiously — so both rank above `pass`.
 * `informational` sits last: it is not a verdict on the model at all (LEGAL/
 * STYLE entries, corpus notes), so it never outranks any real verdict.
 */
const STATUS_SEVERITY: readonly Status[] = ["fail", "unknown", "unimplemented", "pass", "informational"];

/**
 * Reduces one rule's findings from a run to the single outcome a consumer
 * should report for that rule: the most severe status present, per the
 * `STATUS_SEVERITY` ordering above. Does not alter or filter `findings` —
 * the granular, per-finding list (e.g. one entry per placement) remains the
 * source of truth for anything that needs individual locations.
 *
 * The registry guarantees every corpus rule yields at least one finding on
 * every run (see `Registry.run`), so a run's full `Finding[]` should never
 * be missing entries for a rule that's actually in the corpus. If this
 * function is called with a `ruleId` that has zero matching findings, that
 * is not a legitimate "no opinion" case to paper over with a default status
 * (e.g. quietly returning `unimplemented` or `unknown`) — it means either
 * the caller passed the wrong id, or passed a findings list that was
 * filtered/truncated before reaching here, or the registry's guarantee was
 * itself violated. All three are bugs, so this throws rather than guessing.
 */
export function ruleOutcome(findings: Finding[], ruleId: string): Status {
  const statuses = new Set(findings.filter((f) => f.ruleId === ruleId).map((f) => f.status));
  if (statuses.size === 0) {
    throw new Error(
      `ruleOutcome: no finding tagged with ruleId "${ruleId}" was found among the ${findings.length} ` +
        `finding(s) supplied. The registry guarantees every corpus rule produces at least one finding ` +
        `per run, so an empty result here means the wrong ruleId was passed, the findings list was ` +
        `filtered before reaching this call, or that guarantee was violated — not that the rule has no ` +
        `outcome yet.`,
    );
  }
  for (const status of STATUS_SEVERITY) {
    if (statuses.has(status)) return status;
  }
  // Unreachable: STATUS_SEVERITY lists every Status value, and `statuses` is
  // non-empty and drawn only from Status, so the loop above always returns.
  throw new Error(
    `ruleOutcome: findings for "${ruleId}" carry status/es not covered by STATUS_SEVERITY: ` +
      `${[...statuses].join(", ")}. STATUS_SEVERITY must list every Status value.`,
  );
}
