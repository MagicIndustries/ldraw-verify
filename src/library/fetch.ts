import AdmZip from "adm-zip";
import { mkdir, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";

export const PARTS_LIBRARY_URL = "https://library.ldraw.org/library/updates/complete.zip";

async function exists(p: string): Promise<boolean> {
  try {
    await stat(p);
    return true;
  } catch {
    return false;
  }
}

/**
 * Download and extract the official parts library into `cacheDir`, returning
 * the path to the extracted `ldraw` root. Never vendored into the repo:
 * the library is CC BY 4.0 and is a build-time artifact.
 */
export async function ensurePartsLibrary(cacheDir = ".cache"): Promise<string> {
  const root = join(cacheDir, "ldraw");
  if (await exists(join(root, "parts"))) return root;

  await mkdir(cacheDir, { recursive: true });
  const zipPath = join(cacheDir, "complete.zip");

  if (!(await exists(zipPath))) {
    const res = await fetch(PARTS_LIBRARY_URL);
    if (!res.ok) throw new Error(`parts library download failed: ${res.status} ${res.statusText}`);
    await writeFile(zipPath, Buffer.from(await res.arrayBuffer()));
  }

  new AdmZip(zipPath).extractAllTo(cacheDir, true);
  if (!(await exists(join(root, "parts")))) {
    throw new Error(`extracted archive has no ldraw/parts directory under ${cacheDir}`);
  }
  return root;
}
