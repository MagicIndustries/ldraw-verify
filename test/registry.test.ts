import { describe, expect, it } from "vitest";
import { LibraryIndex } from "../src/library/index.js";
import { parseDocument } from "../src/parse/document.js";
import { resolveModel } from "../src/resolve/resolve.js";
import { loadCorpus, Registry } from "../src/rules/registry.js";

const lib = await LibraryIndex.fromDirectory("test/fixtures/lib");
const model = resolveModel(parseDocument("1 4 0 0 0 1 0 0 0 1 0 0 0 1 3001.dat", "a.ldr"), lib);

describe("Registry", () => {
  it("loads rule metadata from the corpus", async () => {
    const r = await Registry.create("rules/lego-build-rules.yaml");
    expect(r.meta("B-06")!.tier).toBe("HARD");
    expect(r.meta("B-06")!.name).toBe("NO_FLOATING_PARTS");
  });

  it("reports a HARD corpus rule with no predicate as unimplemented", async () => {
    const r = await Registry.create("rules/lego-build-rules.yaml");
    const f = r.run(model, lib).find((x) => x.ruleId === "L-12");
    expect(f!.status).toBe("unimplemented");
  });

  it("reports LEGAL-tier entries as informational, never executed", async () => {
    const r = await Registry.create("rules/lego-build-rules.yaml");
    const f = r.run(model, lib).find((x) => x.ruleId === "G-01");
    expect(f!.status).toBe("informational");
  });

  it("runs a registered predicate", async () => {
    const r = await Registry.create("rules/lego-build-rules.yaml");
    r.register({
      id: "B-06",
      needs: ["placements"],
      run: () => [{ ruleId: "B-06", tier: "HARD", status: "fail", message: "boom", locations: [] }],
    });
    expect(r.run(model, lib).find((x) => x.ruleId === "B-06")!.status).toBe("fail");
  });

  it("returns unknown when a declared dependency is unavailable", async () => {
    const r = await Registry.create("rules/lego-build-rules.yaml");
    r.register({ id: "B-06", needs: ["graph"], run: () => [] });
    expect(r.run(model, lib).find((x) => x.ruleId === "B-06")!.status).toBe("unknown");
  });

  it("does not let a predicate impersonate another rule via a mismatched ruleId", async () => {
    const r = await Registry.create("rules/lego-build-rules.yaml");
    // B-06's predicate misbehaves and tags its finding as B-01 instead.
    r.register({
      id: "B-06",
      needs: ["placements"],
      run: () => [{ ruleId: "B-01", tier: "HARD", status: "fail", message: "forged", locations: [] }],
    });
    const findings = r.run(model, lib);

    // B-06 must not vanish from the report, and must not read as a pass.
    const b06 = findings.filter((x) => x.ruleId === "B-06");
    expect(b06).toHaveLength(1);
    expect(b06[0]!.status).not.toBe("pass");
    expect(b06[0]!.status).toBe("unknown");

    // B-01 must not gain a forged entry from B-06's predicate — it should
    // show up exactly once, with its genuine (unimplemented) status.
    const b01 = findings.filter((x) => x.ruleId === "B-01");
    expect(b01).toHaveLength(1);
    expect(b01[0]!.status).toBe("unimplemented");
  });

  it("fails loudly when a corpus file parses but has no rules: key", async () => {
    await expect(loadCorpus("test/fixtures/corpus-no-rules-key.yaml")).rejects.toThrow(
      /rules/i,
    );
  });

  it("rejects duplicate registration of the same rule id", async () => {
    const r = await Registry.create("rules/lego-build-rules.yaml");
    r.register({ id: "B-06", needs: ["placements"], run: () => [] });
    expect(() => r.register({ id: "B-06", needs: ["placements"], run: () => [] })).toThrow();
  });

  it("fails loudly on a corpus entry missing an id, naming its position", async () => {
    await expect(loadCorpus("test/fixtures/corpus-missing-id.yaml")).rejects.toThrow(/1|id/i);
  });

  it("turns a throwing predicate into an unknown finding instead of crashing the run", async () => {
    const r = await Registry.create("rules/lego-build-rules.yaml");
    r.register({
      id: "B-06",
      needs: ["placements"],
      run: () => {
        throw new Error("predicate exploded");
      },
    });
    const findings = r.run(model, lib);
    const b06 = findings.find((x) => x.ruleId === "B-06");
    expect(b06!.status).toBe("unknown");
    expect(b06!.message + JSON.stringify(b06!.evidence ?? {})).toMatch(/predicate exploded/);

    // The rest of the corpus must still be reported — the run must not abort.
    const l12 = findings.find((x) => x.ruleId === "L-12");
    expect(l12!.status).toBe("unimplemented");
  });
});
