import { describe, expect, it } from "vitest";
import { parseAttrs, parseSnapMetas } from "../src/connect/shadow.js";

describe("parseSnapMetas", () => {
  it("extracts a SNAP_CYL meta with its attributes", () => {
    const metas = parseSnapMetas("0 !LDCAD SNAP_CYL [gender=M] [caps=one] [secs=R 6 4] [pos=0 -4 0]");
    expect(metas).toHaveLength(1);
    expect(metas[0]!.type).toBe("SNAP_CYL");
    expect(metas[0]!.attrs.gender).toBe("M");
    expect(metas[0]!.attrs.pos).toBe("0 -4 0");
  });

  it("ignores non-LDCAD meta lines and geometry", () => {
    expect(parseSnapMetas("0 BFC CERTIFY CCW\n4 16 0 0 0 1 0 0 0 1 0 0 0 1")).toHaveLength(0);
  });

  it("captures every snap type it is given", () => {
    const text = ["SNAP_CYL", "SNAP_CLP", "SNAP_FGR", "SNAP_GEN", "SNAP_SPH", "SNAP_INCL", "SNAP_CLEAR"]
      .map((t) => `0 !LDCAD ${t} [id=x]`)
      .join("\n");
    expect(parseSnapMetas(text).map((m) => m.type)).toEqual([
      "SNAP_CYL", "SNAP_CLP", "SNAP_FGR", "SNAP_GEN", "SNAP_SPH", "SNAP_INCL", "SNAP_CLEAR",
    ]);
  });

  it("tolerates spaces around the equals sign", () => {
    expect(parseAttrs("[gender = F] [pos = 0 0 0]").gender).toBe("F");
  });

  it("returns an empty object when there are no attributes", () => {
    expect(parseAttrs("")).toEqual({});
  });
});
