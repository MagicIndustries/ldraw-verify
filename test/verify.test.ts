import { describe, expect, it } from "vitest";
import { exitCodeFor } from "../src/verify.js";
import type { Finding } from "../src/rules/types.js";

const f = (tier: Finding["tier"], status: Finding["status"]): Finding => ({
  ruleId: "X", tier, status, message: "", locations: [],
});

describe("exitCodeFor", () => {
  it("returns 0 when everything passes", () => {
    expect(exitCodeFor([f("HARD", "pass"), f("DISCOURAGED", "pass")])).toBe(0);
  });

  it("returns 1 for any HARD failure", () => {
    expect(exitCodeFor([f("DISCOURAGED", "fail"), f("HARD", "fail")])).toBe(1);
  });

  it("returns 2 for DISCOURAGED failures only", () => {
    expect(exitCodeFor([f("DISCOURAGED", "fail")])).toBe(2);
  });

  it("returns 0 when the only non-passes are unknown or unimplemented", () => {
    expect(exitCodeFor([f("HARD", "unknown"), f("HARD", "unimplemented")])).toBe(0);
  });

  it("ignores informational findings", () => {
    expect(exitCodeFor([f("LEGAL", "informational")])).toBe(0);
  });
});
