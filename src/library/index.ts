import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";

export interface LibraryPart {
  id: string;
  description: string;
  isAlias: boolean;
  isHidden: boolean;
  movedTo?: string;
  path: string;
}

const MOVED_TO = /^~Moved to\s+(\S+)/i;

export class LibraryIndex {
  private constructor(private readonly parts: Map<string, LibraryPart>) {}

  static async fromDirectory(root: string): Promise<LibraryIndex> {
    const parts = new Map<string, LibraryPart>();
    for (const sub of ["parts", "p"]) {
      const dir = join(root, sub);
      let names: string[];
      try {
        names = await readdir(dir);
      } catch {
        continue;
      }
      for (const name of names) {
        if (!name.toLowerCase().endsWith(".dat")) continue;
        const path = join(dir, name);
        const head = (await readFile(path, "utf8")).split(/\r?\n/, 1)[0] ?? "";
        const description = head.replace(/^0\s*/, "").trim();
        const moved = MOVED_TO.exec(description);
        const movedTo = moved?.[1];
        parts.set(name.toLowerCase(), {
          id: name,
          description,
          isAlias: moved !== null,
          isHidden: description.startsWith("~"),
          path,
          ...(movedTo !== undefined ? { movedTo } : {}),
        });
      }
    }
    return new LibraryIndex(parts);
  }

  get(id: string): LibraryPart | undefined {
    return this.parts.get(id.toLowerCase());
  }

  has(id: string): boolean {
    return this.parts.has(id.toLowerCase());
  }

  async readText(id: string): Promise<string> {
    const p = this.get(id);
    if (!p) throw new Error(`part not in library: ${id}`);
    return readFile(p.path, "utf8");
  }

  get size(): number {
    return this.parts.size;
  }
}
