import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { spawn } from "child_process";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";

const cliEntry = path.resolve(__dirname, "../../src/cli/index.ts");
const tsxBin = path.resolve(__dirname, "../../node_modules/.bin/tsx");

let tmpHome: string;

beforeEach(() => {
  tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), "diagno-config-e2e-"));
});

afterEach(() => {
  fs.rmSync(tmpHome, { recursive: true, force: true });
});

function runCli(
  args: string[],
): Promise<{ stdout: string; code: number | null }> {
  return new Promise((resolve) => {
    const child = spawn(tsxBin, [cliEntry, ...args], {
      cwd: path.resolve(__dirname, "../.."),
      env: {
        ...process.env,
        ANTHROPIC_API_KEY: "",
        HOME: tmpHome,
        USERPROFILE: tmpHome,
      },
    });
    let stdout = "";
    child.stdout.on("data", (chunk) => (stdout += chunk.toString()));
    child.stderr.on("data", (chunk) => (stdout += chunk.toString()));
    child.on("close", (code) => resolve({ stdout, code }));
  });
}

describe("diagno config (end-to-end)", () => {
  it("round-trips setting and getting the API key through the real CLI", async () => {
    const setResult = await runCli([
      "config",
      "set",
      "api-key",
      "sk-ant-realkey123",
    ]);
    expect(setResult.code).toBe(0);
    expect(setResult.stdout).not.toContain("realkey123");

    const getResult = await runCli(["config", "get", "api-key"]);
    expect(getResult.code).toBe(0);
    expect(getResult.stdout).not.toContain("realkey123");

    const revealResult = await runCli(["config", "get", "api-key", "--reveal"]);
    expect(revealResult.stdout).toContain("sk-ant-realkey123");

    // Confirm it actually persisted to disk, not just in-memory.
    const configPath = path.join(tmpHome, ".diagno", "config.json");
    const saved = JSON.parse(fs.readFileSync(configPath, "utf8"));
    expect(saved.apiKey).toBe("sk-ant-realkey123");
  });

  it("a stored api-key enables the AI fallback path (attempted, not skipped)", async () => {
    await runCli(["config", "set", "api-key", "sk-ant-fake-not-a-real-key"]);

    // Ambiguous failure -> DIAGNO will *try* to call the AI provider now that
    // a key is configured. It will fail (fake key, no real network call
    // expected to succeed), but the failure mode should be a provider
    // error, never "no key found".
    const result = await runCli([
      "node",
      "-e",
      "console.error('some totally generic assertion failure'); process.exit(1)",
    ]);

    expect(result.stdout).not.toContain("No Anthropic API key found");
  });

  it("without a stored key or env var, the AI fallback is skipped with a helpful message", async () => {
    const result = await runCli([
      "node",
      "-e",
      "console.error('some totally generic assertion failure'); process.exit(1)",
    ]);

    expect(result.stdout).toContain("No Anthropic API key found");
    expect(result.stdout).toContain("diagno config set api-key");
  });

  it("config path reflects the overridden home directory", async () => {
    const result = await runCli(["config", "path"]);
    expect(result.stdout.trim()).toBe(
      path.join(tmpHome, ".diagno", "config.json"),
    );
  });
});
