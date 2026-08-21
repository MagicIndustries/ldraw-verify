import { readFile } from "node:fs/promises";
import { parse } from "yaml";
import type { LibraryIndex } from "../library/index.js";
import type { ResolvedModel } from "../resolve/ir.js";
import type { Finding, Need, Rule, RuleMeta, Tier } from "./types.js";

interface CorpusEntry {
  id: string;
  name?: string;
  tier?: string;
  statement?: string;
  check?: string;
}

export async function loadCorpus(path: string): Promise<Map<string, RuleMeta>> {
  const doc = parse(await readFile(path, "utf8")) as { rules?: CorpusEntry[] };
  const out = new Map<string, RuleMeta>();
  for (const e of doc.rules ?? []) {
    out.set(e.id, {
      id: e.id,
      name: e.name ?? e.id,
      tier: (e.tier ?? "STYLE") as Tier,
      statement: e.statement ?? "",
      ...(e.check !== undefined ? { check: e.check } : {}),
    });
  }
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
      if (meta.tier === "LEGAL" || meta.tier === "STYLE") {
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

      const produced = rule.run({ model, library, meta });
      findings.push(
        ...(produced.length > 0
          ? produced
          : [{ ruleId: meta.id, tier: meta.tier, status: "pass" as const, message: meta.statement, locations: [] }]),
      );
    }

    return findings;
  }
}
