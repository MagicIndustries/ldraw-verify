import { readFile } from "node:fs/promises";
import { parse } from "yaml";
import type { LibraryIndex } from "../library/index.js";
import type { ResolvedModel } from "../resolve/ir.js";
import type { Finding, Need, Rule, RuleDomain, RuleKind, RuleMeta, Tier } from "./types.js";

interface CorpusEntry {
  id: string;
  name?: string;
  tier?: string;
  statement?: string;
  check?: string;
  kind?: string;
  domain?: string;
}

export async function loadCorpus(path: string): Promise<Map<string, RuleMeta>> {
  const parsed: unknown = parse(await readFile(path, "utf8"));
  const rules = (parsed as { rules?: unknown } | null)?.rules;
  if (!Array.isArray(rules)) {
    throw new Error(
      `corpus file "${path}" has no top-level "rules:" list (expected an array under the ` +
        `"rules" key; the file parsed but that key is missing, not an array, or the wrong ` +
        `file was passed). Refusing to load a corpus that would silently report nothing.`,
    );
  }

  const out = new Map<string, RuleMeta>();
  rules.forEach((raw, i) => {
    const e = raw as CorpusEntry;
    if (typeof e?.id !== "string" || e.id.trim() === "") {
      throw new Error(`corpus file "${path}": entry at rules[${i}] is missing a usable "id"`);
    }
    out.set(e.id, {
      id: e.id,
      name: e.name ?? e.id,
      // Permissions and references carry no tier by design; STYLE is the
      // non-gating stand-in so a Finding always has one to report.
      tier: (e.tier ?? "STYLE") as Tier,
      statement: e.statement ?? "",
      ...(e.check !== undefined ? { check: e.check } : {}),
      ...(e.kind !== undefined ? { kind: e.kind as RuleKind } : {}),
      ...(e.domain !== undefined ? { domain: e.domain as RuleDomain } : {}),
    });
  });
  return out;
}

export class Registry {
  private readonly rules = new Map<string, Rule>();

  private constructor(private readonly corpus: Map<string, RuleMeta>) {}

  static async create(corpusPath: string): Promise<Registry> {
    return new Registry(await loadCorpus(corpusPath));
  }

  meta(id: string): RuleMeta | undefined {
    return this.corpus.get(id);
  }

  register(rule: Rule): void {
    if (!this.corpus.has(rule.id)) throw new Error(`rule ${rule.id} is not in the corpus`);
    if (this.rules.has(rule.id)) throw new Error(`rule ${rule.id} is already registered`);
    this.rules.set(rule.id, rule);
  }

  private available(model: ResolvedModel): Set<Need> {
    const s = new Set<Need>(["placements", "library", "document"]);
    if (model.graph) s.add("graph");
    return s;
  }

  /**
   * Executes HARD and DISCOURAGED rules that have a predicate. Everything else
   * in the corpus is reported with a reason — nothing is silently skipped.
   */
  run(model: ResolvedModel, library: LibraryIndex): Finding[] {
    const have = this.available(model);
    const findings: Finding[] = [];

    for (const meta of this.corpus.values()) {
      // Non-gating entries. A permission or a reference cannot be violated,
      // so it is reported for the record and never evaluated -- previously
      // inferred from `tier === "LEGAL"`, which conflated a permission with a
      // severity. STYLE remains a real tier on a real constraint (L-12,
      // T-11): a rule that can be violated but never gates.
      if (meta.kind === "permission" || meta.kind === "reference" || meta.tier === "STYLE" || meta.tier === "LEGAL") {
        findings.push({ ruleId: meta.id, tier: meta.tier, status: "informational", message: meta.statement, locations: [] });
        continue;
      }

      const rule = this.rules.get(meta.id);
      if (!rule) {
        findings.push({ ruleId: meta.id, tier: meta.tier, status: "unimplemented", message: meta.statement, locations: [] });
        continue;
      }

      const missing = rule.needs.filter((n) => !have.has(n));
      if (missing.length > 0) {
        findings.push({
          ruleId: meta.id,
          tier: meta.tier,
          status: "unknown",
          message: `not evaluated: missing ${missing.join(", ")}`,
          locations: [],
        });
        continue;
      }

      let produced: Finding[];
      try {
        produced = rule.run({ model, library, meta });
        const impostors = produced.filter((f) => f.ruleId !== meta.id);
        if (impostors.length > 0) {
          throw new Error(
            `predicate registered for ${meta.id} produced finding(s) tagged with ruleId ` +
              `${impostors.map((f) => f.ruleId).join(", ")} instead of ${meta.id}`,
          );
        }
      } catch (err) {
        // A throwing predicate, or one that forges another rule's ruleId, is a
        // programming error in that predicate — not proof the model passed, and
        // not grounds to abort the run for every other rule. Surface it as its
        // own diagnostic for this rule's slot and keep going. Any findings the
        // predicate produced are discarded rather than trusted, since a
        // predicate that misbehaves once (throws, or mislabels output) cannot
        // be trusted for the rest of its output in the same call either.
        findings.push({
          ruleId: meta.id,
          tier: meta.tier,
          status: "unknown",
          message: `predicate for ${meta.id} failed to run cleanly`,
          locations: [],
          evidence: { error: err instanceof Error ? err.message : String(err) },
        });
        continue;
      }

      findings.push(
        ...(produced.length > 0
          ? produced
          : [{ ruleId: meta.id, tier: meta.tier, status: "pass" as const, message: meta.statement, locations: [] }]),
      );
    }

    return findings;
  }
}
