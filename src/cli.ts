#!/usr/bin/env node
import { renderHuman } from "./report/human.js";
import { renderJson } from "./report/json.js";
import { verifyFile } from "./verify.js";
import type { VerifyOptions } from "./verify.js";

function flag(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i === -1 ? undefined : process.argv[i + 1];
}

const file = process.argv[2];
if (!file || file.startsWith("--")) {
  console.error("usage: ldraw-verify <model.ldr|model.mpd> [--library <dir>] [--shadow-dir <dir>] [--json]");
  process.exit(3);
}

try {
  const libraryRoot = flag("library") ?? ".cache/ldraw";
  const shadowDir = flag("shadow-dir") ?? process.env.LDCAD_SHADOW_DIR;
  const corpusPath = flag("rules");

  // exactOptionalPropertyTypes forbids assigning `string | undefined` to an
  // optional `string` property outright -- an omitted key and a key
  // explicitly set to undefined are distinct here. Conditional spread keeps
  // the key absent entirely when the flag/env var wasn't given, rather than
  // presenting `undefined` as if it were a real value.
  const opts: VerifyOptions = {
    libraryRoot,
    ...(shadowDir !== undefined ? { shadowDir } : {}),
    ...(corpusPath !== undefined ? { corpusPath } : {}),
  };

  const result = await verifyFile(file, opts);
  if (process.argv.includes("--json")) {
    console.log(renderJson(result));
  } else {
    console.error(renderHuman(result));
  }
  process.exit(result.exitCode);
} catch (err) {
  console.error(`ldraw-verify: ${(err as Error).message}`);
  process.exit(3);
}
