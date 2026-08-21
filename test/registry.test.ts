import { describe, expect, it } from "vitest";
import { LibraryIndex } from "../src/library/index.js";
import { parseDocument } from "../src/parse/document.js";
import { resolveModel } from "../src/resolve/resolve.js";
import { Registry } from "../src/rules/registry.js";

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
});
