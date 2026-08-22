import { beforeAll, describe, expect, it } from "vitest";
import { collectSnapMetas } from "../src/connect/closure.js";
import { buildGraph } from "../src/connect/graph.js";
import { metasToHotspots } from "../src/connect/hotspots.js";
import { openShadowLibrary, type ShadowLibrary } from "../src/connect/shadow.js";
import { LibraryIndex } from "../src/library/index.js";
import { parseDocument } from "../src/parse/document.js";
import { resolveModel } from "../src/resolve/resolve.js";
import { l5Rules } from "../src/rules/l5-legality.js";
import type { RuleMeta } from "../src/rules/types.js";

// These golden facts were independently established by inspecting the real
// LDraw parts library and LDCad shadow library (see task-10-report.md).
// They are skipped, rather than faked, when LDCAD_SHADOW_DIR isn't set, so
// CI without the (CC BY-SA, not vendored) shadow library stays green.
const shadowDir = process.env.LDCAD_SHADOW_DIR;

describe.skipIf(!shadowDir)("golden facts", () => {
  // LibraryIndex.fromDirectory reads the first line of every .dat file in
  // .cache/ldraw (tens of thousands of files); on a cold filesystem cache
  // that alone can exceed vitest's default 5s test timeout. (Repeat scans
  // are now memoised process-wide -- see LibraryIndex.fromDirectory -- so
  // this hoisting is no longer load-bearing for the SECOND call onwards,
  // but the first one still has to read the directory.) Load it once
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

  // ------------------------------------------------------------------
  // B-05 scope, against the real shadow library rather than hand-written
  // metas (test/hotspots.test.ts covers the derivation itself). Every
  // matrix below is copied verbatim off a line of the real OMR model
  // 7903-1.mpd, whose nose section the author wrote inline at ~40 degrees:
  // this is the exact corpus placement the verification pass judged, so a
  // regression here is a regression against measured ground truth.
  // ------------------------------------------------------------------
  const b05Meta: RuleMeta = { id: "B-05", name: "NO_FRACTIONAL_ROTATION", tier: "HARD", statement: "" };
  const b05 = l5Rules.find((r) => r.id === "B-05")!;

  const runB05 = async (line: string) => {
    const model = resolveModel(parseDocument(line, "tilt.ldr"), lib);
    model.graph = await buildGraph(model, lib, sh);
    return b05.run({ model, library: lib, meta: b05Meta });
  };

  it(
    "still fails 3040b.dat at the ~40-degree tilt it carries in 7903-1.mpd",
    async () => {
      const f = await runB05(
        "1 15 -30 -57.772 78.697 1 0 0 0 0.764921 -0.644124 0 0.644124 0.764921 3040b.dat",
      );
      expect(f).toHaveLength(1);
      expect(f[0]!.status).toBe("fail");
    },
    30_000,
  );

  it(
    "still fails 6091.dat at the ~40-degree tilt it carries in 7903-1.mpd",
    async () => {
      const f = await runB05(
        "1 4 -30 -76.774 88.844 -1 0 0 0 0.764921 0.644124 0 0.644124 -0.764921 6091.dat",
      );
      expect(f).toHaveLength(1);
      expect(f[0]!.status).toBe("fail");
    },
    30_000,
  );

  // 6141.dat sits on the same lines of the same model at the same
  // rotation, and is the part the verification pass counted as this
  // rule's single largest false positive. Its connectors are all round
  // and all on its one axis, so it is out of scope -- see B-05's doc
  // comment for why the tilt does not bring it back in while 3040b's does.
  it(
    "makes no claim about 6141.dat at that same tilt",
    async () => {
      const f = await runB05(
        "1 71 -30 -58.415 104.301 -1 0 0 0 0.764921 0.644124 0 0.644124 -0.764921 6141.dat",
      );
      expect(f).toHaveLength(0);
    },
    30_000,
  );

  // The guard that keeps the symmetry exemption from swallowing the rule:
  // 3024.dat is a square 1x1 plate, connectors in the same two places as
  // 6141.dat, and 45 degrees of yaw on it is exactly what B-05 is for.
  it(
    "still fails a square 1x1 plate (3024.dat) at 45 degrees of yaw",
    async () => {
      const c = Math.SQRT1_2;
      const f = await runB05(`1 4 0 -24 0 ${c} 0 ${c} 0 1 0 ${-c} 0 ${c} 3024.dat`);
      expect(f).toHaveLength(1);
      expect(f[0]!.status).toBe("fail");
    },
    30_000,
  );
});
