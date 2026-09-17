import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { spawn } from "child_process";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";

const cliEntry = path.resolve(__dirname, "../../src/cli/index.ts");
const tsxBin = path.resolve(__dirname, "../../node_modules/.bin/tsx");
const fixtureSource = path.resolve(__dirname, "../fixtures/fixable-demo");

function runCliIn(
  cwd: string,
  args: string[]
): Promise<{ stdout: string; code: number | null }> {
  return new Promise((resolve) => {
    const child = spawn(tsxBin, [cliEntry, ...args], {
      cwd,
      env: { ...process.env, ANTHROPIC_API_KEY: "" },
    });
    let stdout = "";
    child.stdout.on("data", (chunk) => (stdout += chunk.toString()));
    child.stderr.on("data", (chunk) => (stdout += chunk.toString()));
    child.on("close", (code) => resolve({ stdout, code }));
  });
}

let workDir: string;

beforeEach(() => {
  // Copy the fixture into a scratch directory so --fix's real file mutation
  // never touches the repo's own fixture (keeping the test idempotent).
  workDir = fs.mkdtempSync(path.join(os.tmpdir(), "sift-fix-e2e-"));
  for (const name of fs.readdirSync(fixtureSource)) {
    fs.copyFileSync(path.join(fixtureSource, name), path.join(workDir, name));
  }
});

afterEach(() => {
  fs.rmSync(workDir, { recursive: true, force: true });
});

describe("sift --fix end-to-end", () => {
  it("shows a diff, applies the fix, reruns, and confirms resolution with --yes", async () => {
    const jestConfigBefore = fs.readFileSync(
      path.join(workDir, "jest.config.js"),
      "utf8"
    );
    expect(jestConfigBefore).not.toContain("moduleNameMapper");

    const result = await runCliIn(workDir, [
      "--fix",
      "--yes",
      "node",
      "check-fixed.js",
    ]);

    // The diff shown before applying.
    expect(result.stdout).toContain("+  moduleNameMapper: {");

    // The rerun and final verdict.
    expect(result.stdout).toContain("Re-running: node check-fixed.js");
    expect(result.stdout).toContain("Fixed! The original failure no longer reproduces.");
    expect(result.code).toBe(0);

    const jestConfigAfter = fs.readFileSync(
      path.join(workDir, "jest.config.js"),
      "utf8"
    );
    expect(jestConfigAfter).toContain("moduleNameMapper");
    // The rest of the original file must survive.
    expect(jestConfigAfter).toContain("testEnvironment");
  });

  it("does not touch the file without confirmation (non-interactive, no --yes)", async () => {
    const result = await runCliIn(workDir, ["--fix", "node", "check-fixed.js"]);

    expect(result.stdout).toContain("Fix not applied.");
    expect(result.code).toBe(1);

    const jestConfigAfter = fs.readFileSync(
      path.join(workDir, "jest.config.js"),
      "utf8"
    );
    expect(jestConfigAfter).not.toContain("moduleNameMapper");
  });

  it("reports the fix via --json without prompting, requiring --yes explicitly", async () => {
    const result = await runCliIn(workDir, [
      "--json",
      "--fix",
      "node",
      "check-fixed.js",
    ]);

    const parsed = JSON.parse(result.stdout);
    expect(parsed.fix.applicable).toBe(true);
    expect(parsed.fix.requiresConfirmation).toBe(true);
    expect(parsed.fix.applied).toBeUndefined();

    const jestConfigAfter = fs.readFileSync(
      path.join(workDir, "jest.config.js"),
      "utf8"
    );
    expect(jestConfigAfter).not.toContain("moduleNameMapper");
  });

  it("applies via --json --yes and reports the resolved outcome as structured data", async () => {
    const result = await runCliIn(workDir, [
      "--json",
      "--fix",
      "--yes",
      "node",
      "check-fixed.js",
    ]);

    const parsed = JSON.parse(result.stdout);
    expect(parsed.fix.applied).toBe(true);
    expect(parsed.fix.resolved).toBe(true);
    expect(parsed.fix.rerun.success).toBe(true);
  });
});
