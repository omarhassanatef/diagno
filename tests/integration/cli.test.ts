import { describe, it, expect } from "vitest";
import { spawn } from "child_process";
import path from "path";

const cliEntry = path.resolve(__dirname, "../../src/cli/index.ts");
const tsxBin = path.resolve(__dirname, "../../node_modules/.bin/tsx");

function runCli(args: string[]): Promise<{
  stdout: string;
  stderr: string;
  code: number | null;
}> {
  return new Promise((resolve) => {
    const child = spawn(tsxBin, [cliEntry, ...args], {
      cwd: path.resolve(__dirname, "../.."),
      env: { ...process.env, ANTHROPIC_API_KEY: "" },
    });

    let stdout = "";
    let stderr = "";

    child.stdout.on("data", (chunk) => (stdout += chunk.toString()));
    child.stderr.on("data", (chunk) => (stderr += chunk.toString()));

    child.on("close", (code) => resolve({ stdout, stderr, code }));
  });
}

describe("diagno CLI", () => {
  it("prints help and exits with code 1 when called with no arguments", async () => {
    const result = await runCli([]);
    expect(result.stdout).toContain("Usage:");
    expect(result.code).toBe(1);
  });

  it("prints help and exits 0 with --help", async () => {
    const result = await runCli(["--help"]);
    expect(result.stdout).toContain("Usage:");
    expect(result.code).toBe(0);
  });

  it("prints the version with --version", async () => {
    const result = await runCli(["--version"]);
    expect(result.stdout.trim()).toMatch(/^\d+\.\d+\.\d+$/);
    expect(result.code).toBe(0);
  });

  it("runs a wrapped command and reports success", async () => {
    const result = await runCli([process.execPath, "-e", "process.exit(0)"]);
    expect(result.stdout).toContain("\u2713");
    expect(result.code).toBe(0);
  });

  it("runs a wrapped command and reports failure with exit code", async () => {
    const result = await runCli([process.execPath, "-e", "process.exit(5)"]);
    expect(result.stdout).toContain("\u2717");
    expect(result.stdout).toContain("exit code 5");
    expect(result.code).toBe(5);
  });

  it("reports a clean error for a missing command", async () => {
    const result = await runCli(["this-command-does-not-exist-xyz-123"]);
    expect(result.stdout).toContain("Command not found");
    expect(result.stdout).not.toContain("at Object"); // no raw JS stack trace
    expect(result.code).toBe(127);
  });
});
