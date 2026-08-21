import type { Status, VerifyResult } from "../rules/types.js";

const MARK: Record<Status, string> = {
  fail: "FAIL",
  unknown: "????",
  unimplemented: "----",
  pass: "ok  ",
  informational: "info",
};

export function renderHuman(r: VerifyResult): string {
  const lines: string[] = [];
  for (const f of r.findings) {
    if (f.status === "pass" || f.status === "informational") continue;
    const loc = f.locations[0];
    const where = loc ? ` ${loc.file}:${loc.line}` : "";
    lines.push(`${MARK[f.status]} [${f.tier}] ${f.ruleId}${where} — ${f.message}`);
  }
  const pct = Math.round(r.coverage * 100);
  lines.push("");
  lines.push(`connectivity coverage: ${pct}%${pct < 100 ? "  (rules needing connectivity may report unknown)" : ""}`);
  return lines.join("\n");
}
