import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { buildGraph } from "./connect/graph.js";
import { openShadowLibrary, type ShadowLibrary } from "./connect/shadow.js";
import { LibraryIndex } from "./library/index.js";
import { parseDocument } from "./parse/document.js";
import { resolveModel } from "./resolve/resolve.js";
import { l0Rules } from "./rules/l0-syntax.js";
import { l1Rules } from "./rules/l1-references.js";
import { l2Rules } from "./rules/l2-matrix.js";
import { l3Rules } from "./rules/l3-grid.js";
import { l4Rules } from "./rules/l4-connectivity.js";
import { l5Rules } from "./rules/l5-legality.js";
import { Registry } from "./rules/registry.js";
import type { Finding, VerifyResult } from "./rules/types.js";

export interface VerifyOptions {
  libraryRoot: string;
  shadowDir?: string;
  corpusPath?: string;
}

/**
 * Default corpus location, resolved relative to this module rather than
 * `process.cwd()`. The task-13 brief's original snippet defaulted to the
 * bare cwd-relative string `"rules/lego-build-rules.yaml"`, which only
 * resolves when the process happens to be launched from the repo root --
 * true for every test here (vitest runs from the project root) but false
 * for a real CLI invocation from an arbitrary working directory, which is
 * the whole point of a `bin` entry. This mirrors the fix already applied to
 * `DATA_PATH` in src/rules/l5-legality.ts for the same reason.
 *
 * This file (`src/verify.ts`) sits one directory below the repo root, where
 * `rules/lego-build-rules.yaml` also lives one directory below the repo
 * root, so `../rules/lego-build-rules.yaml` reaches it. Once compiled,
 * `dist/src/verify.js` sits one directory below `dist/` in exactly the same
 * shape -- `tsc`'s `rootDir: "."` mirrors the whole repo layout into
 * `dist/`, and the `build` script copies `rules/lego-build-rules.yaml` to
 * `dist/rules/lego-build-rules.yaml` to match -- so the same relative
 * string resolves correctly from both the source and compiled locations.
 * See test/cli-dist.test.ts, which runs the compiled CLI from an unrelated
 * working directory specifically to catch a regression here.
 */
const DEFAULT_CORPUS_PATH = fileURLToPath(new URL("../rules/lego-build-rules.yaml", import.meta.url));

/**
 * `unknown` and `unimplemented` never fail a run -- a verifier that blocks
 * on its own ignorance gets switched off, and roughly a fifth of parts have
 * no connectivity data at all, so `unknown` from a graph-needing rule is a
 * permanent, expected outcome rather than a defect to gate on. Only an
 * actual `fail` moves the exit code off 0: a HARD fail always wins (1), and
 * absent any HARD fail, a DISCOURAGED fail downgrades to 2. Informational
 * (LEGAL/STYLE) findings are never verdicts and are ignored entirely.
 */
export function exitCodeFor(findings: Finding[]): 0 | 1 | 2 {
  let discouraged = false;
  for (const f of findings) {
    if (f.status !== "fail") continue;
    if (f.tier === "HARD") return 1;
    if (f.tier === "DISCOURAGED") discouraged = true;
  }
  return discouraged ? 2 : 0;
}

/**
 * Registers every rule module that currently exists. `Registry.register`
 * throws on a duplicate id or an id absent from the corpus, so any overlap
 * or typo here is a hard failure at startup rather than a silently dropped
 * rule. Rule ids not covered by any module below stay `unimplemented` by
 * design -- see the corpus and the task-13 brief for the current roster.
 */
export const ALL_RULES = [...l0Rules, ...l1Rules, ...l2Rules, ...l3Rules, ...l4Rules, ...l5Rules];

/**
 * A parts library, shadow library and rule registry, loaded once and reused
 * across many models.
 *
 * `verifyFile` below rebuilt all three on every call. That is fine for the one
 * -- file case the CLI was written for and badly wrong for anything sweeping a
 * corpus: re-reading the parts index per model is the visible cost, but the
 * expensive one is invisible. `collectSnapMetas` memoises each part's resolved
 * reference closure in a `WeakMap` keyed on the LibraryIndex *and* the
 * ShadowLibrary instance (see closure.ts), so handing it fresh objects each
 * time silently discards that cache and re-walks every part's closure from
 * scratch. Measured A/B over 25 models spread across the corpus: 22.4s calling
 * `verifyFile` per model against 11.4s reusing one `Verifier`, a 2.0x
 * saving.
 *
 * Holding a `Verifier` pins the parts library in memory for its lifetime,
 * which is the point -- create one per sweep, not one per model, and let it go
 * when the sweep ends.
 */
export class Verifier {
  private constructor(
    private readonly library: LibraryIndex,
    private readonly registry: Registry,
    private readonly shadow: ShadowLibrary | undefined,
  ) {}

  static async create(opts: VerifyOptions): Promise<Verifier> {
    const library = await LibraryIndex.fromDirectory(opts.libraryRoot);
    const registry = await Registry.create(opts.corpusPath ?? DEFAULT_CORPUS_PATH);
    for (const rule of ALL_RULES) {
      registry.register(rule);
    }
    return new Verifier(library, registry, opts.shadowDir ? openShadowLibrary(opts.shadowDir) : undefined);
  }

  async verifyFile(path: string): Promise<VerifyResult> {
    return this.verifyText(await readFile(path, "utf8"), path);
  }

  /** For callers that already hold the text -- a sweep reading its own files, or a test. */
  async verifyText(text: string, path: string): Promise<VerifyResult> {
    const model = resolveModel(parseDocument(text, path), this.library);
    if (this.shadow) {
      model.graph = await buildGraph(model, this.library, this.shadow);
    }
    const findings = this.registry.run(model, this.library);
    return { findings, coverage: model.graph?.coverage.ratio ?? 0, exitCode: exitCodeFor(findings) };
  }
}

/**
 * Verify one file, loading everything it needs and throwing it away again.
 * Convenient for a single model; use `Verifier.create` once for more than one.
 */
export async function verifyFile(path: string, opts: VerifyOptions): Promise<VerifyResult> {
  const verifier = await Verifier.create(opts);
  return verifier.verifyFile(path);
}
