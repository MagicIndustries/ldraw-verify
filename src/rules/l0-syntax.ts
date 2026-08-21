import type { Finding, Rule, RuleContext } from "./types.js";

const COLOUR_MAIN = 16;
const COLOUR_EDGE = 24;

/**
 * The structural document.errors codes E-05 owns. Kept as an exported
 * constant (rather than inline string literals in the filter below) so the
 * L0/L1 coverage test can assert this set, together with E10_OWNED_CODES,
 * exhausts every code the parsing layer can emit — see
 * test/rules-l0-l1.test.ts.
 */
export const E05_OWNED_CODES: readonly string[] = [
  "L0_CONTENT_BEFORE_FILE",
  "L1_DUPLICATE_FILE",
  "L0_ORPHANED_CONTENT",
];

/**
 * The tokenizer error codes E-10 owns. See E05_OWNED_CODES above for why
 * this is exported rather than inlined.
 */
export const E10_OWNED_CODES: readonly string[] = ["L0_TOKEN_COUNT", "L0_NON_NUMERIC", "L0_LINE_TYPE"];

const modelColour: Rule = {
  id: "E-03",
  needs: ["document"],
  run({ model, meta }: RuleContext): Finding[] {
    const out: Finding[] = [];

    // Colour 16 ("inherit from my caller") is only nonsensical at the top
    // level, where there is no caller. Inside a submodel block it is
    // legitimate and common, so this half of the check is scoped to
    // blocks[0] (the main model) only.
    //
    // Within that scope, a further distinction matters: a top-level line
    // can reference either an actual PART or another "0 FILE" block in this
    // same MPD (a submodel). Colour 16 on a reference to a *submodel* is not
    // the same claim as colour 16 on a reference to a *part* -- the
    // submodel's own lines carry their own real colours, so the outer
    // reference's colour is inert, and real OMR sets built from named
    // submodels (train cars, sticker sheets, minifigs as their own blocks)
    // do this routinely. Only a direct part reference at the top level has
    // no caller to inherit from. See the Task 14 report for the measured
    // false-positive rate this fixes.
    const submodelNames = new Set(model.document.blocks.map((b) => b.name.toLowerCase()));
    const main = model.document.blocks[0];
    if (main) {
      for (const line of main.lines) {
        if (line.kind !== "subfile") continue;
        if (line.colour !== COLOUR_MAIN) continue;
        if (submodelNames.has(line.name.toLowerCase())) continue;
        out.push({
          ruleId: meta.id,
          tier: meta.tier,
          status: "fail",
          message:
            'colour 16 on a top-level type-1 line means "inherit from my caller"; the main model has no caller and will render as fallback mustard',
          locations: [{ file: main.name, line: line.line, partId: line.name }],
          evidence: { colour: line.colour },
        });
      }
    }

    // Colour 24 (the edge colour) is valid only on line types 2 and 5. It is
    // invalid on a type-1 line everywhere — main model or submodel — so this
    // half of the check scans every block in the document, not just blocks[0].
    for (const block of model.document.blocks) {
      for (const line of block.lines) {
        if (line.kind !== "subfile") continue;
        if (line.colour !== COLOUR_EDGE) continue;
        out.push({
          ruleId: meta.id,
          tier: meta.tier,
          status: "fail",
          message: "colour 24 is for line types 2 and 5 only, never a type-1 line",
          locations: [{ file: block.name, line: line.line, partId: line.name }],
          evidence: { colour: line.colour },
        });
      }
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
      if (!E05_OWNED_CODES.includes(e.code)) continue;
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

/**
 * Owns the raw line-syntax errors the tokenizer detects (L0_TOKEN_COUNT,
 * L0_NON_NUMERIC, L0_LINE_TYPE). Without this rule those errors reach
 * document.errors and are never read by anything, so a file with a malformed
 * line passes clean — the tool detects a defect and then silently discards
 * it. See E10_OWNED_CODES above and the coverage test in
 * test/rules-l0-l1.test.ts.
 */
const fileParses: Rule = {
  id: "E-10",
  needs: ["document"],
  run({ model, meta }: RuleContext): Finding[] {
    const out: Finding[] = [];
    for (const e of model.document.errors) {
      if (!E10_OWNED_CODES.includes(e.code)) continue;
      out.push({
        ruleId: meta.id,
        tier: meta.tier,
        status: "fail",
        message: e.message,
        locations: [{ file: model.document.path, line: e.line }],
        evidence: { code: e.code },
      });
    }
    return out;
  },
};

export const l0Rules: Rule[] = [modelColour, mpdStructure, fileParses];
