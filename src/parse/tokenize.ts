import { GEOM_COORD_COUNT, type LDrawLine, type Mat3, type ParseError, type Vec3 } from "./ast.js";

function err(line: number, code: string, message: string): ParseError {
  return { kind: "error", line, code, message };
}

/**
 * Tokenize one source line. Filenames may contain spaces, so a type-1 line is
 * split into exactly 14 leading fields and everything after is the filename.
 */
export function tokenizeLine(text: string, line: number): LDrawLine | ParseError {
  const trimmed = text.trim();
  if (trimmed === "") return { kind: "meta", text: "", line };

  const parts = trimmed.split(/\s+/);
  const lineType = Number(parts[0]);

  if (lineType === 0) {
    return { kind: "meta", text: trimmed.slice(1).trim(), line };
  }

  if (lineType === 1) {
    if (parts.length < 15) {
      return err(line, "L0_TOKEN_COUNT", `type-1 line needs 14 fields then a filename, got ${parts.length}`);
    }
    const nums = parts.slice(1, 14).map(Number);
    if (nums.some((n) => !Number.isFinite(n))) {
      return err(line, "L0_NON_NUMERIC", "non-numeric field in a type-1 line");
    }
    const name = parts.slice(14).join(" ");
    return {
      kind: "subfile",
      colour: nums[0]!,
      pos: [nums[1]!, nums[2]!, nums[3]!] as Vec3,
      mat: nums.slice(4, 13) as unknown as Mat3,
      name,
      line,
    };
  }

  if (lineType === 2 || lineType === 3 || lineType === 4 || lineType === 5) {
    const need = GEOM_COORD_COUNT[lineType];
    const nums = parts.slice(1).map(Number);
    if (nums.length !== need + 1) {
      return err(line, "L0_TOKEN_COUNT", `type-${lineType} line needs ${need + 1} fields, got ${nums.length}`);
    }
    if (nums.some((n) => !Number.isFinite(n))) {
      return err(line, "L0_NON_NUMERIC", `non-numeric field in a type-${lineType} line`);
    }
    return { kind: "geom", lineType, colour: nums[0]!, coords: nums.slice(1), line };
  }

  return err(line, "L0_LINE_TYPE", `unknown line type "${parts[0]}"`);
}
