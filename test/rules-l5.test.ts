import { describe, expect, it } from "vitest";
import type { ConnectionGraph } from "../src/connect/graph.js";
import { LibraryIndex } from "../src/library/index.js";
import { parseDocument } from "../src/parse/document.js";
import { resolveModel } from "../src/resolve/resolve.js";
import { l5Rules } from "../src/rules/l5-legality.js";
import type { RuleMeta } from "../src/rules/types.js";

const lib = await LibraryIndex.fromDirectory("test/fixtures/lib");
const meta = (id: string): RuleMeta => ({ id, name: id, tier: "HARD", statement: "" });
const byId = (id: string) => l5Rules.find((r) => r.id === id)!;

// degradedGridPlacements, unreliableAxisPlacements and clipOnlyPlacements
// are required fields on ConnectionGraph (added by task 10/11/14 work,
// after this task's brief was written -- see task-12-report.md and the
// Task 14 report); all are set empty here since none of these fixtures
// exercise grid degradation, unreliable-axis, or clip-only placements.
const emptyGraph = (total: number): ConnectionGraph => ({
  edges: [],
  coverage: { withData: total, total, ratio: 1 },
  unknownPlacements: [],
  degradedGridPlacements: [],
  unreliableAxisPlacements: [],
  clipOnlyPlacements: [],
  components: 1,
  // componentOf / incompleteDataPlacements / fullyAccountedPlacements are
  // required fields added by the B-06 reformulation (final fix wave, item
  // 3). Every placement here is in one component with complete data; no
  // B-05/B-01 fixture in this file exercises them.
  componentOf: new Array<number>(total).fill(0),
  incompleteDataPlacements: [],
  fullyAccountedPlacements: [],
});

describe("B-05 no fractional rotation", () => {
  it("passes an axis-aligned placement", () => {
    const model = resolveModel(parseDocument("1 4 0 -24 0 1 0 0 0 1 0 0 0 1 3001.dat", "t.ldr"), lib);
    model.graph = emptyGraph(1);
    model.graph.singleStudParts = new Set([0]);
    expect(byId("B-05").run({ model, library: lib, meta: meta("B-05") })).toHaveLength(0);
  });

  it("fails a 45-degree yaw on a single-stud part", () => {
    const c = Math.SQRT1_2;
    const model = resolveModel(
      parseDocument(`1 4 0 -24 0 ${c} 0 ${c} 0 1 0 ${-c} 0 ${c} 3001.dat`, "t.ldr"),
      lib,
    );
    model.graph = emptyGraph(1);
    model.graph.singleStudParts = new Set([0]);
    const f = byId("B-05").run({ model, library: lib, meta: meta("B-05") });
    expect(f[0]!.status).toBe("fail");
  });

  it("returns unknown when no graph is available", () => {
    const model = resolveModel(parseDocument("1 4 0 -24 0 1 0 0 0 1 0 0 0 1 3001.dat", "t.ldr"), lib);
    expect(byId("B-05").run({ model, library: lib, meta: meta("B-05") })[0]!.status).toBe("unknown");
  });

  // ------------------------------------------------------------------
  // Scope. See `noFractionalRotation`'s doc comment: this rule is only a
  // claim about parts whose rotation is measurable and not set by a joint.
  // ------------------------------------------------------------------

  // A round 1x1 plate (6141.dat) at 33 degrees. Every one of its
  // connectors lies on its one axis, so a turn about that axis moves
  // nothing: there is no yaw to be a multiple of anything.
  it("does not fire on a rotationally symmetric part at an arbitrary yaw", () => {
    const c = Math.cos(Math.PI / 180 * 33);
    const s = Math.sin(Math.PI / 180 * 33);
    const model = resolveModel(
      parseDocument(`1 4 0 -24 0 ${c} 0 ${s} 0 1 0 ${-s} 0 ${c} 3001.dat`, "t.ldr"),
      lib,
    );
    model.graph = emptyGraph(1);
    model.graph.singleStudParts = new Set([0]);
    model.graph.rotationallySymmetricParts = new Set([0]);
    expect(byId("B-05").run({ model, library: lib, meta: meta("B-05") })).toHaveLength(0);
  });

  // The same 33 degrees on a part that is NOT symmetric -- a square 1x1
  // plate has its connectors in the same two places but a square anti-stud
  // cavity, so its corners genuinely end up between detents.
  it("fires on a genuinely asymmetric single-stud part at the same sub-detent yaw", () => {
    const c = Math.cos(Math.PI / 180 * 33);
    const s = Math.sin(Math.PI / 180 * 33);
    const model = resolveModel(
      parseDocument(`1 4 0 -24 0 ${c} 0 ${s} 0 1 0 ${-s} 0 ${c} 3001.dat`, "t.ldr"),
      lib,
    );
    model.graph = emptyGraph(1);
    model.graph.singleStudParts = new Set([0]);
    const f = byId("B-05").run({ model, library: lib, meta: meta("B-05") });
    expect(f).toHaveLength(1);
    expect(f[0]!.status).toBe("fail");
  });

  // A symmetric part is outside this rule's scope even when its matrix is
  // malformed: the rule has no question to be uncertain about, and saying
  // `unknown` would still be answering one. E-01 reports the malformed
  // matrix independently -- see l2-matrix.ts.
  it("says nothing at all about a rotationally symmetric part with a malformed matrix", () => {
    const model = resolveModel(parseDocument("1 4 0 -24 0 1 0 0 1 0 0 0 0 1 3001.dat", "t.ldr"), lib);
    model.graph = emptyGraph(1);
    model.graph.singleStudParts = new Set([0]);
    model.graph.rotationallySymmetricParts = new Set([0]);
    expect(byId("B-05").run({ model, library: lib, meta: meta("B-05") })).toHaveLength(0);
  });

  // A hinge frees ONE axis. Rotating about that axis is the joint being
  // set; the placement is a legitimate one whatever the angle.
  it("does not fire when the rotation is a free turn about a joint axis the part carries", () => {
    // A 40-degree pitch about X, on a part whose hinge axis is X.
    const c = Math.cos(Math.PI / 180 * 40);
    const s = Math.sin(Math.PI / 180 * 40);
    const model = resolveModel(
      parseDocument(`1 4 0 -24 0 1 0 0 0 ${c} ${-s} 0 ${s} ${c} 3001.dat`, "t.ldr"),
      lib,
    );
    model.graph = emptyGraph(1);
    model.graph.singleStudParts = new Set([0]);
    model.graph.freeRotationAxes = new Map([[0, [[1, 0, 0]]]]);
    expect(byId("B-05").run({ model, library: lib, meta: meta("B-05") })).toHaveLength(0);
  });

  // The same part, the same hinge, but turned about a DIFFERENT axis: a
  // hinge plate yawed 45 degrees while its hinge axis lies horizontal owes
  // that yaw to whatever its studs are seated in, not to its hinge.
  it("still fires when the rotation is not about the joint axis the part carries", () => {
    const c = Math.SQRT1_2;
    const model = resolveModel(
      parseDocument(`1 4 0 -24 0 ${c} 0 ${c} 0 1 0 ${-c} 0 ${c} 3001.dat`, "t.ldr"),
      lib,
    );
    model.graph = emptyGraph(1);
    model.graph.singleStudParts = new Set([0]);
    model.graph.freeRotationAxes = new Map([[0, [[0, 0, 1]]]]);
    const f = byId("B-05").run({ model, library: lib, meta: meta("B-05") });
    expect(f).toHaveLength(1);
    expect(f[0]!.status).toBe("fail");
  });

  // Finding 2: a singular, non-orthonormal matrix with a duplicated row (row
  // 0 == row 1 == [1,0,0]) has all nine rotation entries in {0,1} -- the
  // per-entry axis-alignment check sees only zeros and ones and would
  // wrongly call this "aligned", and since no finding was pushed for it, the
  // registry would synthesize an overall `pass` for a transform E-01 is
  // simultaneously failing as singular (det3 == 0). B-05 must not claim
  // `pass` here: it cannot tell whether the rotation is axis-aligned when
  // the rotation itself isn't a valid rotation.
  it("does not report pass for a singular matrix with a duplicated row", () => {
    const model = resolveModel(
      parseDocument("1 4 0 -24 0 1 0 0 1 0 0 0 0 1 3001.dat", "t.ldr"),
      lib,
    );
    model.graph = emptyGraph(1);
    model.graph.singleStudParts = new Set([0]);
    const f = byId("B-05").run({ model, library: lib, meta: meta("B-05") });
    expect(f.some((finding) => finding.status === "pass")).toBe(false);
    expect(f).toHaveLength(1);
    expect(f[0]!.status).toBe("unknown");
  });
});

describe("B-01 no stud in a Technic pinhole", () => {
  it("fails an edge from a stud-radius male hotspot into a genuine Technic through-hole (femaleCaps=none)", () => {
    const model = resolveModel(
      parseDocument(
        ["1 4 0 -24 0 1 0 0 0 1 0 0 0 1 3001.dat", "1 4 0 -48 0 1 0 0 0 1 0 0 0 1 3700.dat"].join("\n"),
        "t.ldr",
      ),
      lib,
    );
    model.graph = {
      ...emptyGraph(2),
      edges: [{ a: 0, b: 1, female: 1, male: 0, kind: "SNAP_CYL", at: [0, -34, 0], radius: 6, maleRadius: 6, femaleCaps: "none" }],
    };
    const f = byId("B-01").run({ model, library: lib, meta: meta("B-01") });
    expect(f[0]!.status).toBe("fail");
  });

  // Task 14 finding: every real Technic axle/pin (e.g. 3706.dat "Technic
  // Axle 6", 6558.dat "Technic Pin Long with Friction and Slot") also
  // reports a stud-radius male SNAP_CYL hotspot and can pair with a genuine
  // caps=none through-hole -- but seating an axle/pin in a Technic hole is
  // the ordinary, intended use of that hole, not the System-stud violation
  // this rule names. [slide=true] is what every such axle/pin carries, and
  // no genuine System stud primitive does, so a sliding male connector must
  // not be flagged even when it is a confirmed through-hole at stud radius.
  it("does not fail a sliding (axle/pin) male connector even into a confirmed through-hole", () => {
    const model = resolveModel(
      parseDocument(
        ["1 4 0 -24 0 1 0 0 0 1 0 0 0 1 3001.dat", "1 4 0 -48 0 1 0 0 0 1 0 0 0 1 3700.dat"].join("\n"),
        "t.ldr",
      ),
      lib,
    );
    model.graph = {
      ...emptyGraph(2),
      edges: [{ a: 0, b: 1, female: 1, male: 0, kind: "SNAP_CYL", at: [0, -34, 0], radius: 6, maleRadius: 6, femaleCaps: "none", maleSlide: true }],
    };
    expect(byId("B-01").run({ model, library: lib, meta: meta("B-01") })).toHaveLength(0);
  });

  // Task 14 finding: every real Technic-hole-class part (3700/3701/3702/
  // 3894/6541/32000) carries BOTH a genuine through-hole (connhole.dat,
  // caps=none) AND an entirely separate, ordinary blind anti-stud tube
  // (caps=one) for normal top/bottom stacking, at the same nominal 6 LDU
  // radius. Radius alone cannot tell them apart -- measured against the
  // real corpus, this made B-01 fail on ~89% of real, legally-stacked OMR
  // sets (see the Task 14 report). caps=one (an ordinary blind socket, not
  // a through-hole) must not be mistaken for a stud entering a pinhole even
  // when the radius matches and the far end is a Technic-hole part.
  it("does not fail an ordinary radius-6 stacking connection onto a Technic hole part (femaleCaps=one)", () => {
    const model = resolveModel(
      parseDocument(
        ["1 4 0 -24 0 1 0 0 0 1 0 0 0 1 3001.dat", "1 4 0 -48 0 1 0 0 0 1 0 0 0 1 3700.dat"].join("\n"),
        "t.ldr",
      ),
      lib,
    );
    model.graph = {
      ...emptyGraph(2),
      edges: [{ a: 0, b: 1, female: 1, male: 0, kind: "SNAP_CYL", at: [0, -34, 0], radius: 6, maleRadius: 6, femaleCaps: "one" }],
    };
    expect(byId("B-01").run({ model, library: lib, meta: meta("B-01") })).toHaveLength(0);
  });

  it("does not fail a radius-6 edge with no femaleCaps data at all", () => {
    // No caps= signal means this tool cannot tell a through-hole from a
    // blind socket; the honest default is not to flag it, matching this
    // tool's "never fabricate a verdict it can't support" principle.
    const model = resolveModel(
      parseDocument(
        ["1 4 0 -24 0 1 0 0 0 1 0 0 0 1 3001.dat", "1 4 0 -48 0 1 0 0 0 1 0 0 0 1 3700.dat"].join("\n"),
        "t.ldr",
      ),
      lib,
    );
    model.graph = { ...emptyGraph(2), edges: [{ a: 0, b: 1, female: 1, male: 0, kind: "SNAP_CYL", at: [0, -34, 0], radius: 6, maleRadius: 6 }] };
    expect(byId("B-01").run({ model, library: lib, meta: meta("B-01") })).toHaveLength(0);
  });

  it("passes when neither end is a Technic hole part", () => {
    const model = resolveModel(
      parseDocument(
        ["1 4 0 -24 0 1 0 0 0 1 0 0 0 1 3001.dat", "1 4 0 -48 0 1 0 0 0 1 0 0 0 1 3001.dat"].join("\n"),
        "t.ldr",
      ),
      lib,
    );
    model.graph = {
      ...emptyGraph(2),
      edges: [{ a: 0, b: 1, female: 1, male: 0, kind: "SNAP_CYL", at: [0, -34, 0], radius: 6, maleRadius: 6, femaleCaps: "none" }],
    };
    expect(byId("B-01").run({ model, library: lib, meta: meta("B-01") })).toHaveLength(0);
  });

  it("passes an edge landing on a Technic hole part when the radius isn't a stud's", () => {
    const model = resolveModel(
      parseDocument(
        ["1 4 0 -24 0 1 0 0 0 1 0 0 0 1 3001.dat", "1 4 0 -48 0 1 0 0 0 1 0 0 0 1 3700.dat"].join("\n"),
        "t.ldr",
      ),
      lib,
    );
    // radius 2 is nowhere near the 6 LDU stud radius (+-0.5 tolerance), so
    // this must not be mistaken for a stud entering the pinhole even though
    // the far end is a Technic-hole part and it's a genuine through-hole.
    model.graph = {
      ...emptyGraph(2),
      edges: [{ a: 0, b: 1, female: 1, male: 0, kind: "SNAP_CYL", at: [0, -34, 0], radius: 2, maleRadius: 2, femaleCaps: "none" }],
    };
    expect(byId("B-01").run({ model, library: lib, meta: meta("B-01") })).toHaveLength(0);
  });

  it("returns unknown when no graph is available", () => {
    const model = resolveModel(
      parseDocument(
        ["1 4 0 -24 0 1 0 0 0 1 0 0 0 1 3001.dat", "1 4 0 -48 0 1 0 0 0 1 0 0 0 1 3700.dat"].join("\n"),
        "t.ldr",
      ),
      lib,
    );
    expect(byId("B-01").run({ model, library: lib, meta: meta("B-01") })[0]!.status).toBe("unknown");
  });

  // 3700.dat is itself a Technic-hole-class part that also carries ordinary
  // System studs, so two 3700.dat placements mating normally is realistic --
  // and both endpoints are Technic-hole-class at once. This once produced two
  // findings for one connection, because the rule tried both orientations to
  // see if EITHER end qualified. Reading `female` removes the ambiguity at
  // source: there is only one socket, so there is only one orientation to
  // consider. Kept as a regression guard on one-finding-per-connection.
  it("reports exactly one finding for one edge between two Technic-hole-class parts", () => {
    const model = resolveModel(
      parseDocument(
        ["1 4 0 -24 0 1 0 0 0 1 0 0 0 1 3700.dat", "1 4 0 -48 0 1 0 0 0 1 0 0 0 1 3700.dat"].join("\n"),
        "t.ldr",
      ),
      lib,
    );
    model.graph = {
      ...emptyGraph(2),
      edges: [{ a: 0, b: 1, female: 1, male: 0, kind: "SNAP_CYL", at: [0, -34, 0], radius: 6, maleRadius: 6, femaleCaps: "none" }],
    };
    const f = byId("B-01").run({ model, library: lib, meta: meta("B-01") });
    expect(f).toHaveLength(1);
    expect(f[0]!.status).toBe("fail");
  });

  // The false positive that produced all 33 of B-01's findings across the
  // 1,464-model corpus, and zero true ones. `caps=none` means "open at both
  // ends", which a hollow stud reports just as a Technic pinhole does. A
  // 3062b (Brick 1x1 Round with Hollow Stud) stacked normally on a Technic
  // brick pairs the ROUND BRICK's hollow anti-stud (the female, caps=none)
  // with the Technic brick's ordinary top stud. The Technic brick's pinhole
  // sits ten LDU away and is not party to the connection, but the old test
  // -- "is either endpoint a Technic-hole part" -- blamed it anyway.
  it("passes a hollow-stud round brick stacked on a Technic brick, where the caps=none female is the round brick's own bore", () => {
    const model = resolveModel(
      parseDocument(
        ["1 4 0 -24 0 1 0 0 0 1 0 0 0 1 3062b.dat", "1 4 0 -48 0 1 0 0 0 1 0 0 0 1 3700.dat"].join("\n"),
        "t.ldr",
      ),
      lib,
    );
    // female is placement 0, the round brick: its hollow bore is the socket,
    // and the Technic brick supplies the stud. Same two parts as the failing
    // fixture above; only which end is the socket differs.
    model.graph = {
      ...emptyGraph(2),
      edges: [{ a: 0, b: 1, female: 0, male: 1, kind: "SNAP_CYL", at: [0, -34, 0], radius: 6, maleRadius: 6, femaleCaps: "none" }],
    };
    expect(byId("B-01").run({ model, library: lib, meta: meta("B-01") })).toHaveLength(0);
  });

  // A Technic pin in a hole surfaces as three edges at one point, and only
  // one carries slide=true. Reading maleSlide off a single edge misses the
  // evidence on its duplicates, so a correctly seated pin was reported as a
  // stud in a pinhole -- this is why the L-04.legal canon fixture fired B-01.
  it("passes a seated pin whose slide=true evidence sits on a co-located duplicate edge", () => {
    const model = resolveModel(
      parseDocument(
        ["1 4 0 -24 0 1 0 0 0 1 0 0 0 1 3673.dat", "1 4 0 -48 0 1 0 0 0 1 0 0 0 1 3700.dat"].join("\n"),
        "t.ldr",
      ),
      lib,
    );
    model.graph = {
      ...emptyGraph(2),
      edges: [
        { a: 0, b: 1, female: 1, male: 0, kind: "SNAP_CYL", at: [0, -34, 0], radius: 6, maleRadius: 6, femaleCaps: "none", maleSlide: true },
        { a: 0, b: 1, female: 1, male: 0, kind: "SNAP_CYL", at: [0, -34, 0], radius: 6, maleRadius: 6, femaleCaps: "none" },
        { a: 0, b: 1, female: 1, male: 0, kind: "SNAP_CYL", at: [0, -34, 0], radius: 6, maleRadius: 6, femaleCaps: "none" },
      ],
    };
    expect(byId("B-01").run({ model, library: lib, meta: meta("B-01") })).toHaveLength(0);
  });
});
