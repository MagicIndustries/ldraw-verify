import type { Block, LDrawDocument, ParseError } from "./ast.js";
import { tokenizeLine } from "./tokenize.js";

const FILE_META = /^FILE\s+(.+)$/i;
const NOFILE_META = /^NOFILE\s*$/i;

export function parseDocument(text: string, path: string): LDrawDocument {
  const errors: ParseError[] = [];
  const blocks: Block[] = [];
  const seen = new Set<string>();

  let current: Block | null = null;
  let sawAnyContent = false;
  let haveSeenAnyFile = false;

  const rawLines = text.split(/\r?\n/);

  for (let i = 0; i < rawLines.length; i++) {
    const lineNo = i + 1;
    const token = tokenizeLine(rawLines[i]!, lineNo);

    if (token.kind === "error") {
      errors.push(token);
      continue;
    }

    if (token.kind === "meta") {
      const fileMatch = FILE_META.exec(token.text);
      if (fileMatch) {
        const name = fileMatch[1]!.trim();
        if (seen.has(name.toLowerCase())) {
          errors.push({ kind: "error", line: lineNo, code: "L1_DUPLICATE_FILE", message: `duplicate 0 FILE name "${name}"` });
        }
        seen.add(name.toLowerCase());
        if (!haveSeenAnyFile && sawAnyContent) {
          errors.push({
            kind: "error",
            line: lineNo,
            code: "L0_CONTENT_BEFORE_FILE",
            message: "non-comment content appears before the first 0 FILE",
          });
        }
        haveSeenAnyFile = true;
        current = { name, lines: [], startLine: lineNo };
        blocks.push(current);
        continue;
      }
      if (NOFILE_META.test(token.text)) {
        current = null;
        continue;
      }
      if (token.text !== "") sawAnyContent = true;
      current?.lines.push(token);
      continue;
    }

    // subfile or geom
    sawAnyContent = true;
    if (current === null) {
      current = { name: path, lines: [], startLine: lineNo };
      blocks.push(current);
    }
    current.lines.push(token);
  }

  if (blocks.length === 0) blocks.push({ name: path, lines: [], startLine: 1 });

  return { path, blocks, errors };
}
