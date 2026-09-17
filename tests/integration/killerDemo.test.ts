import { describe, it, expect } from "vitest";
import { spawn } from "child_process";
import * as path from "path";

const cliEntry = path.resolve(__dirname, "../../src/cli/index.ts");
const tsxBin = path.resolve(__dirname, "../../node_modules/.bin/tsx");
const demoFixture = path.resolve(__dirname, "../fixtures/killer-demo");

function runCliIn(cwd: string, args: string[]): Promise<{
  stdout: string;
  code: number | null;
}> {
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

describe("sift CLI end-to-end diagnosis (killer demo)", () => {
  it("diagnoses the Jest path-alias mismatch with evidence and a fix", async () => {
    const result = await runCliIn(demoFixture, [
      "node",
      "fake-test-runner.js",
    ]);

    // The wrapped command's own output streamed through.
    expect(result.stdout).toContain("Cannot find module '@/modules/users'");

    // SIFT's own diagnosis, in the blueprint's format.
    expect(result.stdout).toContain("WHY IT FAILED");
    expect(result.stdout).toContain("EVIDENCE");
    expect(result.stdout).toContain("LIKELY FIX");
    expect(result.stdout).toContain("moduleNameMapper");
    expect(result.stdout).toContain("Confidence:");
    expect(result.code).toBe(1);
  });

  it("emits structured JSON with --json", async () => {
    const result = await runCliIn(demoFixture, [
      "--json",
      "node",
      "fake-test-runner.js",
    ]);

    const parsed = JSON.parse(result.stdout);
    expect(parsed.outcome.success).toBe(false);
    expect(parsed.findings.length).toBeGreaterThan(0);
    expect(parsed.findings[0].id).toBe("ts-jest-path-alias-mismatch");
  });
});
