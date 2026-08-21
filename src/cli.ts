#!/usr/bin/env node
import { renderHuman } from "./report/human.js";
import { renderJson } from "./report/json.js";
import { verifyFile } from "./verify.js";
import type { VerifyOptions } from "./verify.js";

const KNOWN_VALUE_FLAGS = new Set(["library", "shadow-dir", "rules"]);
const KNOWN_BOOLEAN_FLAGS = new Set(["json"]);
const ALL_KNOWN_FLAGS = new Set([...KNOWN_VALUE_FLAGS, ...KNOWN_BOOLEAN_FLAGS]);

function flag(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  if (i === -1) return undefined;

  // For value-taking flags, verify the next token exists and is not itself a flag
  if (KNOWN_VALUE_FLAGS.has(name)) {
    const value = process.argv[i + 1];
    if (value === undefined) {
      console.error(`usage: ldraw-verify <model.ldr|model.mpd> [--library <dir>] [--shadow-dir <dir>] [--rules <path>] [--json]`);
      console.error(`error: flag --${name} requires a value`);
      process.exit(3);
    }
    if (value.startsWith("--")) {
      console.error(`usage: ldraw-verify <model.ldr|model.mpd> [--library <dir>] [--shadow-dir <dir>] [--rules <path>] [--json]`);
      console.error(`error: flag --${name} has value '${value}' which is itself a flag`);
      process.exit(3);
    }
    return value;
  }

  return undefined;
}

// Validate all flags in argv
for (let i = 2; i < process.argv.length; i++) {
  const arg = process.argv[i];
  if (arg !== undefined && arg.startsWith("--")) {
    const flagName = arg.slice(2);
    if (!ALL_KNOWN_FLAGS.has(flagName)) {
      // Check if this unrecognized flag is actually the value of a preceding value-taking flag
      if (i > 2) {
        const prevArg = process.argv[i - 1];
        if (prevArg !== undefined && prevArg.startsWith("--")) {
          const prevFlagName = prevArg.slice(2);
          if (KNOWN_VALUE_FLAGS.has(prevFlagName)) {
            // This unrecognized flag is the value for the previous flag
            console.error("usage: ldraw-verify <model.ldr|model.mpd> [--library <dir>] [--shadow-dir <dir>] [--rules <path>] [--json]");
            console.error(`error: flag --${prevFlagName} has value '--${flagName}' which is itself a flag`);
            process.exit(3);
          }
        }
      }
      // If we get here, it's truly an unrecognized flag
      console.error("usage: ldraw-verify <model.ldr|model.mpd> [--library <dir>] [--shadow-dir <dir>] [--rules <path>] [--json]");
      console.error(`error: unrecognized flag --${flagName}`);
      process.exit(3);
    }
  }
}

const file = process.argv[2];
if (!file || file.startsWith("--")) {
  console.error("usage: ldraw-verify <model.ldr|model.mpd> [--library <dir>] [--shadow-dir <dir>] [--rules <path>] [--json]");
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
