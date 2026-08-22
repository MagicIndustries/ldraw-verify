import { describe, expect, it } from "vitest";
import { exitCodeFor, Verifier, verifyFile } from "../src/verify.js";
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

const LIB = ".cache/ldraw";
const CORPUS = "rules/lego-build-rules.yaml";
const SHADOW = process.env.LDCAD_SHADOW_DIR;
const FIXTURE = "test/fixtures/illegal/b01-stud-in-pinhole.ldr";
const OTHER_FIXTURE = "test/fixtures/illegal/b06-disconnected.ldr";

describe("Verifier reuse", () => {
  // verifyFile rebuilt the parts library, shadow library and rule registry on
  // every call. The library reload is the obvious cost; the expensive one is
  // that collectSnapMetas keys its closure cache on the library and shadow
  // INSTANCES, so fresh ones silently discard it. These pin the contract that
  // a reused Verifier answers identically to a throwaway one.
  it("gives the same result as verifyFile", async () => {
    const opts = { libraryRoot: LIB, corpusPath: CORPUS, ...(SHADOW ? { shadowDir: SHADOW } : {}) };
    const once = await verifyFile(FIXTURE, opts);
    const verifier = await Verifier.create(opts);
    const reused = await verifier.verifyFile(FIXTURE);
    expect(reused.exitCode).toBe(once.exitCode);
    expect(reused.findings.map((f) => `${f.ruleId}:${f.status}`).sort()).toEqual(
      once.findings.map((f) => `${f.ruleId}:${f.status}`).sort(),
    );
  }, 120_000);

  it("is stable across repeated calls, so cached state cannot leak between models", async () => {
    const verifier = await Verifier.create({ libraryRoot: LIB, corpusPath: CORPUS, ...(SHADOW ? { shadowDir: SHADOW } : {}) });
    const a = await verifier.verifyFile(FIXTURE);
    await verifier.verifyFile(OTHER_FIXTURE);
    const b = await verifier.verifyFile(FIXTURE);
    expect(b.findings.map((f) => `${f.ruleId}:${f.status}`)).toEqual(a.findings.map((f) => `${f.ruleId}:${f.status}`));
  }, 120_000);
});
