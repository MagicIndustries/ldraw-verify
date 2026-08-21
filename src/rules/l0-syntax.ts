import type { Finding, Rule, RuleContext } from "./types.js";

const COLOUR_MAIN = 16;
const COLOUR_EDGE = 24;

const modelColour: Rule = {
  id: "E-03",
  needs: ["document"],
  run({ model, meta }: RuleContext): Finding[] {
    const out: Finding[] = [];
    const main = model.document.blocks[0];
    if (!main) return out;
    for (const line of main.lines) {
      if (line.kind !== "subfile") continue;
      if (line.colour !== COLOUR_MAIN && line.colour !== COLOUR_EDGE) continue;
      out.push({
        ruleId: meta.id,
        tier: meta.tier,
        status: "fail",
        message:
          line.colour === COLOUR_MAIN
            ? 'colour 16 on a top-level type-1 line means "inherit from my caller"; the main model has no caller and will render as fallback mustard'
            : "colour 24 is for line types 2 and 5 only, never a type-1 line",
        locations: [{ file: main.name, line: line.line, partId: line.name }],
        evidence: { colour: line.colour },
      });
    }
    return out;
  },
};

const mpdStructure: Rule = {
  id: "E-05",
  needs: ["document"],
  run({ model, meta }: RuleContext): Finding[] {
    const out: Finding[] = [];
    for (const e of model.document.errors) {
      if (e.code !== "L0_CONTENT_BEFORE_FILE" && e.code !== "L1_DUPLICATE_FILE") continue;
      out.push({
        ruleId: meta.id,
        tier: meta.tier,
        status: "fail",
        message: e.message,
        locations: [{ file: model.document.path, line: e.line }],
        evidence: { code: e.code },
      });
    }
    for (const cycle of model.cycles) {
      out.push({
        ruleId: meta.id,
        tier: meta.tier,
        status: "fail",
        message: `submodel reference cycle: ${cycle.join(" -> ")}`,
        locations: [{ file: model.document.path, line: 1 }],
        evidence: { cycle },
      });
    }
    return out;
  },
};

export const l0Rules: Rule[] = [modelColour, mpdStructure];
