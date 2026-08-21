import type { Block, LDrawDocument, ParseError } from "./ast.js";
import { tokenizeLine } from "./tokenize.js";

const FILE_META = /^FILE\s+(.+)$/i;
const NOFILE_META = /^NOFILE\s*$/i;

/**
 * Build the error for content found while no block is open. `beforeFirstFile`
 * distinguishes content that precedes the very first `0 FILE` (no block has
 * been pushed yet) from content orphaned after a `0 NOFILE` and before the
 * next `0 FILE` (a block has already been pushed) — these are two distinct
 * conditions, so they get two distinct codes.
 */
function orphanedContentError(line: number, beforeFirstFile: boolean): ParseError {
  return beforeFirstFile
    ? { kind: "error", line, code: "L0_CONTENT_BEFORE_FILE", message: "content appears before the first 0 FILE" }
    : {
        kind: "error",
        line,
        code: "L0_ORPHANED_CONTENT",
        message: "content appears outside any 0 FILE block (after 0 NOFILE)",
      };
}

export function parseDocument(text: string, path: string): LDrawDocument {
  const errors: ParseError[] = [];
  const blocks: Block[] = [];
  const seen = new Set<string>();

  const rawLines = text.split(/\r?\n/);
  const tokens = rawLines.map((raw, i) => tokenizeLine(raw, i + 1));

  // Whether this document opens a 0 FILE block anywhere at all. When it does
  // not, the whole document is the single-block fallback for a plain .ldr
  // file (named after its path). When it does, content encountered while no
  // block is open is never fabricated into a block — it's always an error —
  // so that blocks[0] is always the first real 0 FILE block, never a phantom.
  const hasAnyFileBlock = tokens.some((t) => t.kind === "meta" && FILE_META.test(t.text));

  let current: Block | null = null;

  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i]!;
    const lineNo = i + 1;

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
        current = { name, lines: [], startLine: lineNo };
        blocks.push(current);
        continue;
      }
      if (NOFILE_META.test(token.text)) {
        current = null;
        continue;
      }
      if (current === null) {
        // A comment (or other non-FILE/NOFILE meta) line seen while no block
        // is open belongs to no block. This is deliberate: comments outside
        // any block are simply dropped, though non-blank ones still count as
        // stray content for the before-first-FILE / orphaned-content checks
        // below, matching how a geom/subfile line in the same position would
        // be treated.
        if (token.text !== "" && hasAnyFileBlock) {
          errors.push(orphanedContentError(lineNo, blocks.length === 0));
        }
        continue;
      }
      current.lines.push(token);
      continue;
    }

    // subfile or geom content line
    if (current === null) {
      if (hasAnyFileBlock) {
        errors.push(orphanedContentError(lineNo, blocks.length === 0));
        continue;
      }
      current = { name: path, lines: [], startLine: lineNo };
      blocks.push(current);
    }
    current.lines.push(token);
  }

  if (blocks.length === 0) blocks.push({ name: path, lines: [], startLine: 1 });

  return { path, blocks, errors };
}
