import { readFile } from "node:fs/promises";
import { join } from "node:path";

export interface SnapMeta {
  type: string;
  attrs: Record<string, string>;
}

const SNAP_LINE = /^0\s+!LDCAD\s+(SNAP_[A-Z]+)\s*(.*)$/;
const ATTR = /\[\s*([A-Za-z_]+)\s*=\s*([^\]]*?)\s*\]/g;

export function parseAttrs(text: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const m of text.matchAll(ATTR)) out[m[1]!.toLowerCase()] = m[2]!.trim();
  return out;
}

export function parseSnapMetas(text: string): SnapMeta[] {
  const out: SnapMeta[] = [];
  for (const raw of text.split(/\r?\n/)) {
    const m = SNAP_LINE.exec(raw.trim());
    if (!m) continue;
    out.push({ type: m[1]!, attrs: parseAttrs(m[2]!) });
  }
  return out;
}

export interface ShadowLibrary {
  read(relPath: string): Promise<string | undefined>;
}

/**
 * The shadow library is NOT fetched or vendored: it is CC BY-SA 4.0 and
 * ShareAlike propagates into derived connectivity data. Point this at an
 * LDCad installation's shadow/offLib directory.
 */
export function openShadowLibrary(dir: string): ShadowLibrary {
  const cache = new Map<string, string | undefined>();
  return {
    async read(relPath: string): Promise<string | undefined> {
      const key = relPath.toLowerCase();
      if (cache.has(key)) return cache.get(key);
      let text: string | undefined;
      try {
        text = await readFile(join(dir, relPath), "utf8");
      } catch {
        text = undefined;
      }
      cache.set(key, text);
      return text;
    },
  };
}
