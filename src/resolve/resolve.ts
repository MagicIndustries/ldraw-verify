import type { Block, LDrawDocument } from "../parse/ast.js";
import type { LibraryIndex } from "../library/index.js";
import type { Placement, ResolvedModel, UnresolvedRef } from "./ir.js";
import { fromLdraw, IDENTITY4, multiply, type Mat4 } from "./matrix.js";

export function resolveModel(doc: LDrawDocument, lib: LibraryIndex): ResolvedModel {
  const byName = new Map<string, Block>();
  for (const b of doc.blocks) byName.set(b.name.toLowerCase(), b);

  const placements: Placement[] = [];
  const unresolved: UnresolvedRef[] = [];
  const cycles: string[][] = [];

  function walk(block: Block, world: Mat4, path: string[], stack: string[]): void {
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
        placements.push({
          index: placements.length,
          partId: line.name,
          colour: line.colour,
          world: childWorld,
          submodelPath: path,
          file: block.name,
          line: line.line,
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
