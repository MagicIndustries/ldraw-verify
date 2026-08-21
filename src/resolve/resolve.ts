import type { Block, LDrawDocument } from "../parse/ast.js";
import type { LibraryIndex } from "../library/index.js";
import type { Placement, ResolvedModel, UnresolvedRef } from "./ir.js";
import { fromLdraw, IDENTITY4, multiply, type Mat4 } from "./matrix.js";

const LDCAD_GENERATED = /^!LDCAD\s+GENERATED\b/i;

/**
 * True when `block` is LDCad's own auto-generated fallback geometry for a
 * `!LDCAD CONTENT [type=path]` flexible element (see `Placement.generatedFlexPath`
 * for why that matters). This is a block-level marker -- LDCad emits it as a
 * `0 !LDCAD GENERATED [generator=...]` meta line directly inside the block
 * whose subfile lines are the generated segments, always with an explanatory
 * "Do not edit" comment alongside it in real files -- so checking `block.lines`
 * once per block, rather than per line, is both correct and cheap.
 */
function isGeneratedFlexBlock(block: Block): boolean {
  return block.lines.some((l) => l.kind === "meta" && LDCAD_GENERATED.test(l.text));
}

export function resolveModel(doc: LDrawDocument, lib: LibraryIndex): ResolvedModel {
  const byName = new Map<string, Block>();
  for (const b of doc.blocks) byName.set(b.name.toLowerCase(), b);

  const placements: Placement[] = [];
  const unresolved: UnresolvedRef[] = [];
  const cycles: string[][] = [];

  function walk(block: Block, world: Mat4, path: string[], stack: string[]): void {
    const generatedFlexPath = isGeneratedFlexBlock(block);
    for (const line of block.lines) {
      if (line.kind !== "subfile") continue;
      const childWorld = multiply(world, fromLdraw(line.pos, line.mat));
      const key = line.name.toLowerCase();
      const sub = byName.get(key);

      if (sub) {
        if (stack.includes(key)) {
          cycles.push([...stack, key]);
          continue;
        }
        walk(sub, childWorld, [...path, sub.name], [...stack, key]);
        continue;
      }

      if (lib.has(line.name)) {
        // has() and get() share the exact same lookup (strip to the bare
        // filename, lowercase, look up) -- has() true guarantees get()
        // resolves the same entry, never undefined.
        const part = lib.get(line.name)!;

        // A primitive (p/, p/48/, p/8/) is not a model placement -- it is
        // raw geometry meant to be scaled and composed *inside* another
        // part's own .dat file, which is how LDraw part authoring works. A
        // "0 FILE" block that is itself a custom/embedded part (e.g. an OMR
        // set's own decorated sticker sheet, common in real released-set
        // MPDs) legitimately applies wild non-uniform scale to a primitive
        // to build its shape, and walk() recurses into that block exactly
        // like any other submodel because both are "0 FILE" blocks -- there
        // is no other structural signal here that distinguishes "assembly
        // of real parts" from "definition of one custom part". Recording
        // that primitive reference as a model Placement would hand E-01
        // (row-major/orthonormal sanity), E-02 (Y-is-up grid), and E-04
        // (XZ grid) a matrix that was never meant to describe where
        // something sits in the *model* -- see the false-positive
        // investigation this fixes in the Task 14 report.
        if (part.isPrimitive) continue;

        placements.push({
          index: placements.length,
          partId: line.name,
          colour: line.colour,
          world: childWorld,
          local: fromLdraw(line.pos, line.mat),
          submodelPath: path,
          file: block.name,
          line: line.line,
          ...(generatedFlexPath ? { generatedFlexPath: true as const } : {}),
        });
        continue;
      }

      unresolved.push({ name: line.name, file: block.name, line: line.line });
    }
  }

  const main = doc.blocks[0];
  if (main) walk(main, IDENTITY4, [main.name], [main.name.toLowerCase()]);

  return { document: doc, placements, unresolved, cycles };
}
