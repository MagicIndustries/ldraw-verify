import type { VerifyResult } from "../rules/types.js";

export function renderJson(r: VerifyResult): string {
  return JSON.stringify(
    {
      exitCode: r.exitCode,
      connectivityCoverage: r.coverage,
      summary: {
        failed: r.findings.filter((f) => f.status === "fail").length,
        unknown: r.findings.filter((f) => f.status === "unknown").length,
        unimplemented: r.findings.filter((f) => f.status === "unimplemented").length,
      },
      findings: r.findings.filter((f) => f.status !== "informational" && f.status !== "pass"),
    },
    null,
    2,
  );
}
