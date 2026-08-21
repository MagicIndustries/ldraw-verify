import type { Finding, Rule, RuleContext } from "./types.js";

const partsResolve: Rule = {
  id: "E-08",
  needs: ["placements", "library"],
  run({ model, meta }: RuleContext): Finding[] {
    return model.unresolved.map((u) => ({
      ruleId: meta.id,
      tier: meta.tier,
      status: "fail" as const,
      message: `part not in the library and not a submodel in this file: ${u.name}`,
      locations: [{ file: u.file, line: u.line, partId: u.name }],
    }));
  },
};

const noDeprecated: Rule = {
  id: "E-07",
  needs: ["placements", "library"],
  run({ model, library, meta }: RuleContext): Finding[] {
    const out: Finding[] = [];
    for (const p of model.placements) {
      const entry = library.get(p.partId);
      if (!entry || (!entry.isAlias && !entry.isHidden)) continue;
      out.push({
        ruleId: meta.id,
        tier: meta.tier,
        status: "fail",
        message: entry.movedTo
          ? `${p.partId} is a "~Moved to" alias; reference ${entry.movedTo} instead`
          : `${p.partId} has a ~-prefixed description and should not be referenced`,
        locations: [{ file: p.file, line: p.line, partId: p.partId }],
        evidence: { movedTo: entry.movedTo, description: entry.description },
      });
    }
    return out;
  },
};

export const l1Rules: Rule[] = [partsResolve, noDeprecated];
