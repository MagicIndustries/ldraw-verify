import { beforeAll, describe, expect, it } from "vitest";
import { collectSnapMetas } from "../src/connect/closure.js";
import { buildGraph } from "../src/connect/graph.js";
import { metasToHotspots } from "../src/connect/hotspots.js";
import { openShadowLibrary, type ShadowLibrary } from "../src/connect/shadow.js";
import { LibraryIndex } from "../src/library/index.js";
import { parseDocument } from "../src/parse/document.js";
import { resolveModel } from "../src/resolve/resolve.js";

// These golden facts were independently established by inspecting the real
// LDraw parts library and LDCad shadow library (see task-10-report.md).
// They are skipped, rather than faked, when LDCAD_SHADOW_DIR isn't set, so
// CI without the (CC BY-SA, not vendored) shadow library stays green.
const shadowDir = process.env.LDCAD_SHADOW_DIR;

describe.skipIf(!shadowDir)("golden facts", () => {
  // LibraryIndex.fromDirectory reads the first line of every .dat file in
  // .cache/ldraw (tens of thousands of files); on a cold filesystem cache
  // that alone can exceed vitest's default 5s test timeout. Load it once
  // and share it (and the ShadowLibrary) across all three tests below --
  // this also means collectSnapMetas's per-(lib,shadow) memo is warm by the
  // second test, so the 3001.dat closure is only walked once for real.
  let lib: LibraryIndex;
  let sh: ShadowLibrary;

  beforeAll(async () => {
    lib = await LibraryIndex.fromDirectory(".cache/ldraw");
    sh = openShadowLibrary(shadowDir!);
  }, 60_000);

  it(
    "3001.dat has 8 male stud hotspots on top",
    async () => {
      const { metas } = await collectSnapMetas("3001.dat", lib, sh);
      const males = metasToHotspots(metas).filter((h) => h.gender === "male");
      expect(males).toHaveLength(8);
    },
    30_000,
  );

  it(
    "3001.dat has exactly 8 female hotspots on its underside",
    async () => {
      // 3001.dat's only subfile is s\3001s01.dat, whose own shadow file
      // carries one female SNAP_CYL meta with grid=C 4 C 2 20 20 (a 4x2
      // centred grid over the brick's 8 underside tube holes), and no
      // other part in the closure contributes further
      // SNAP_CYL/CLP/FGR/SPH/GEN metas. 4 * 2 = 8, confirmed by running
      // this test against the real shadow library before tightening this
      // assertion from toBeGreaterThan(0) to the equality below.
      const { metas } = await collectSnapMetas("3001.dat", lib, sh);
      const females = metasToHotspots(metas).filter((h) => h.gender === "female");
      expect(females).toHaveLength(8);
    },
    30_000,
  );

  it(
    "brick-on-brick mates at exactly 24 LDU and forms one component",
    async () => {
      const doc = parseDocument(
        ["1 4 0 -24 0 1 0 0 0 1 0 0 0 1 3001.dat", "1 4 0 -48 0 1 0 0 0 1 0 0 0 1 3001.dat"].join("\n"),
        "stack.ldr",
      );
      const g = await buildGraph(resolveModel(doc, lib), lib, sh);
      expect(g.edges.length).toBeGreaterThan(0);
      expect(g.components).toBe(1);
    },
    30_000,
  );
});
