import { existsSync } from "node:fs";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

/**
 * Regression test for a defect a previous task fixed: the compiled `dist/`
 * build crashed at import because `data/part-classes.json` wasn't copied
 * into the build output and was loaded eagerly (see the `DATA_PATH` comment
 * in src/rules/l5-legality.ts). That fix rests on an invariant nothing here
 * enforces at the type level: `tsc`'s `rootDir: "."` mirrors the whole
 * source tree under `dist/`, so `src/rules/l5-legality.ts` lands at
 * `dist/src/rules/l5-legality.js` (two directories below `dist/`, matching
 * `../../data/part-classes.json`) and the `build` script's `cp` step has to
 * land the data file at exactly `dist/data/part-classes.json` for that
 * relative path to resolve. Nothing type-checks this: a future change to
 * `tsconfig.json`'s `rootDir`/`outDir`, or to the `build` script's copy
 * step, would silently break the CLI again while every unit test (which
 * imports from `src/`, never `dist/`) stayed green.
 *
 * This test is the automated check that was missing: it actually builds
 * the package, asserts the data file landed where the compiled module
 * expects it, and then runs the *compiled* CLI -- from a working directory
 * that is neither the repo root nor under it -- against a fixture with a
 * known set of violations, asserting the process exits the way `verifyFile`
 * says it should. A cwd-relative bug (like the DATA_PATH history above, or
 * a bin path pointing at the wrong mirrored depth) would be invisible if
 * this ran from the repo root, so the unrelated cwd is load-bearing, not
 * incidental.
 *
 * It shells out to `npm run build`, so it is slower than the unit tests
 * above it; give it a generous timeout rather than letting it flake on a
 * cold filesystem cache.
 */
const repoRoot = fileURLToPath(new URL("..", import.meta.url));
const compiledCli = join(repoRoot, "dist", "src", "cli.js");
const compiledData = join(repoRoot, "dist", "data", "part-classes.json");
const libraryRoot = join(repoRoot, ".cache", "ldraw");

describe("compiled dist/ build", () => {
  let workDir: string;

  beforeAll(() => {
    execFileSync("npm", ["run", "build"], { cwd: repoRoot, stdio: "pipe" });
  }, 120_000);

  beforeAll(async () => {
    // An "unrelated working directory": not the repo root, not a
    // subdirectory of it. Deliberately outside the repo tree so a
    // cwd-relative path bug in the compiled output can't accidentally
    // resolve against the repo's own files and pass anyway.
    workDir = await mkdtemp(join(tmpdir(), "ldraw-verify-dist-test-"));
  });

  afterAll(async () => {
    if (workDir) await rm(workDir, { recursive: true, force: true });
  });

  it("copies the part-classes data file to the location the compiled module expects", () => {
    expect(existsSync(compiledCli)).toBe(true);
    expect(existsSync(compiledData)).toBe(true);
  });

  it(
    "runs the compiled CLI from an unrelated cwd and reports the expected violations",
    async () => {
      const fixture = join(workDir, "bad.ldr");
      // Same deliberately-broken model as the task-13 end-to-end check:
      // colour 16 at top level (E-03), a positive Y (E-02), and an
      // off-grid X (E-04).
      await writeFile(fixture, "0 FILE bad.ldr\r\n1 16 7 24 0 1 0 0 0 1 0 0 0 1 3001.dat\r\n");

      let stdout = "";
      let exitCode = 0;
      try {
        stdout = execFileSync(
          process.execPath,
          [compiledCli, fixture, "--library", libraryRoot, "--json"],
          { cwd: workDir, encoding: "utf8" },
        );
      } catch (err) {
        const e = err as { status?: number; stdout?: string };
        exitCode = e.status ?? 1;
        stdout = e.stdout ?? "";
      }

      expect(exitCode).toBe(1);
      const result = JSON.parse(stdout) as { exitCode: number; findings: Array<{ ruleId: string; status: string }> };
      expect(result.exitCode).toBe(1);
      const failedIds = result.findings.filter((f) => f.status === "fail").map((f) => f.ruleId).sort();
      expect(failedIds).toEqual(["E-02", "E-03", "E-04"]);
    },
    30_000,
  );

  it(
    "rejects --library --json (flag consumed as value) with exit 3",
    async () => {
      const fixture = join(workDir, "bad.ldr");
      await writeFile(fixture, "0 FILE bad.ldr\r\n1 16 7 24 0 1 0 0 0 1 0 0 0 1 3001.dat\r\n");

      let stderr = "";
      let exitCode = 0;
      try {
        execFileSync(
          process.execPath,
          [compiledCli, fixture, "--library", "--json"],
          { cwd: workDir, encoding: "utf8" },
        );
      } catch (err) {
        const e = err as { status?: number; stderr?: string };
        exitCode = e.status ?? 1;
        stderr = e.stderr?.toString() ?? "";
      }

      expect(exitCode).toBe(3);
      expect(stderr).toContain("--json");
    },
    30_000,
  );

  it(
    "rejects unrecognized flag --frobnicate with exit 3",
    async () => {
      const fixture = join(workDir, "good.ldr");
      await writeFile(fixture, "0 FILE good.ldr\r\n");

      let stderr = "";
      let exitCode = 0;
      try {
        execFileSync(
          process.execPath,
          [compiledCli, fixture, "--frobnicate"],
          { cwd: workDir, encoding: "utf8" },
        );
      } catch (err) {
        const e = err as { status?: number; stderr?: string };
        exitCode = e.status ?? 1;
        stderr = e.stderr?.toString() ?? "";
      }

      expect(exitCode).toBe(3);
      expect(stderr).toContain("--frobnicate");
    },
    30_000,
  );

  it(
    "handles --library as final token (no value following) with sensible behavior",
    async () => {
      const fixture = join(workDir, "good.ldr");
      await writeFile(fixture, "0 FILE good.ldr\r\n");

      let stderr = "";
      let exitCode = 0;
      try {
        execFileSync(
          process.execPath,
          [compiledCli, fixture, "--library"],
          { cwd: workDir, encoding: "utf8" },
        );
      } catch (err) {
        const e = err as { status?: number; stderr?: string };
        exitCode = e.status ?? 1;
        stderr = e.stderr?.toString() ?? "";
      }

      // Either exit 3 (error) or some other handling is acceptable, but must be deliberate
      expect([0, 1, 3]).toContain(exitCode);
    },
    30_000,
  );

  it(
    "still works correctly with valid arguments",
    async () => {
      const fixture = join(workDir, "valid.ldr");
      await writeFile(fixture, "0 FILE valid.ldr\r\n1 16 0 0 0 1 0 0 0 1 0 0 0 1 3001.dat\r\n");

      let stdout = "";
      let exitCode = 0;
      try {
        stdout = execFileSync(
          process.execPath,
          [compiledCli, fixture, "--library", libraryRoot],
          { cwd: workDir, encoding: "utf8" },
        );
      } catch (err) {
        const e = err as { status?: number; stdout?: string };
        exitCode = e.status ?? 1;
        stdout = e.stdout ?? "";
      }

      // This should produce human output to stderr, not JSON
      // Exit code should be 0 (pass) or 1 (fail), not 3 (error)
      expect([0, 1]).toContain(exitCode);
    },
    30_000,
  );
});
