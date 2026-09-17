import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { runConfigCommand } from "../../../src/cli/configCommand";
import { readConfig, writeConfig } from "../../../src/config/configStore";

let tmpHome: string;
let stdout: string;
let stderr: string;
let stdoutSpy: ReturnType<typeof vi.spyOn>;
let stderrSpy: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), "diagno-config-cmd-test-"));
  stdout = "";
  stderr = "";
  stdoutSpy = vi
    .spyOn(process.stdout, "write")
    .mockImplementation((chunk: unknown) => {
      stdout += chunk as string;
      return true;
    });
  stderrSpy = vi
    .spyOn(process.stderr, "write")
    .mockImplementation((chunk: unknown) => {
      stderr += chunk as string;
      return true;
    });
});

afterEach(() => {
  stdoutSpy.mockRestore();
  stderrSpy.mockRestore();
  fs.rmSync(tmpHome, { recursive: true, force: true });
  delete process.env.ANTHROPIC_API_KEY;
});

describe("runConfigCommand", () => {
  it("shows help with no action, exiting 1", async () => {
    const code = await runConfigCommand([], tmpHome);
    expect(code).toBe(1);
    expect(stdout).toContain("diagno config - manage local DIAGNO settings");
  });

  it("shows help with --help, exiting 0", async () => {
    const code = await runConfigCommand(["--help"], tmpHome);
    expect(code).toBe(0);
    expect(stdout).toContain("Usage:");
  });

  it("sets a value and masks it in the confirmation", async () => {
    const code = await runConfigCommand(
      ["set", "api-key", "sk-ant-abc123xyz789"],
      tmpHome,
    );
    expect(code).toBe(0);
    expect(stdout).toContain("Saved api-key");
    expect(stdout).not.toContain("abc123");
    expect(readConfig(tmpHome).apiKey).toBe("sk-ant-abc123xyz789");
  });

  it("rejects an unknown key on set", async () => {
    const code = await runConfigCommand(["set", "bogus-key", "value"], tmpHome);
    expect(code).toBe(1);
    expect(stderr).toContain("Unknown config key");
  });

  it("rejects set with no value", async () => {
    const code = await runConfigCommand(["set", "api-key"], tmpHome);
    expect(code).toBe(1);
    expect(stderr).toContain("Usage: diagno config set");
  });

  it("warns when ANTHROPIC_API_KEY env var will shadow the value just set", async () => {
    process.env.ANTHROPIC_API_KEY = "env-value";
    const code = await runConfigCommand(
      ["set", "api-key", "config-value"],
      tmpHome,
    );
    expect(code).toBe(0);
    expect(stdout).toContain("ANTHROPIC_API_KEY is currently set");
  });

  it("get returns '(not set)' for an unset key", async () => {
    const code = await runConfigCommand(["get", "api-key"], tmpHome);
    expect(code).toBe(0);
    expect(stdout).toContain("(not set)");
  });

  it("get masks a secret by default and reveals it with --reveal", async () => {
    writeConfig({ apiKey: "sk-ant-abc123xyz789" }, tmpHome);

    const maskedCode = await runConfigCommand(["get", "api-key"], tmpHome);
    expect(maskedCode).toBe(0);
    expect(stdout).not.toContain("abc123");

    stdout = "";
    const revealedCode = await runConfigCommand(
      ["get", "api-key", "--reveal"],
      tmpHome,
    );
    expect(revealedCode).toBe(0);
    expect(stdout).toContain("sk-ant-abc123xyz789");
  });

  it("get on a non-secret field (model) shows the value in full without --reveal", async () => {
    writeConfig({ aiModel: "claude-3-5-sonnet-latest" }, tmpHome);
    await runConfigCommand(["get", "model"], tmpHome);
    expect(stdout).toContain("claude-3-5-sonnet-latest");
  });

  it("rejects get for an unknown key", async () => {
    const code = await runConfigCommand(["get", "nonsense"], tmpHome);
    expect(code).toBe(1);
    expect(stderr).toContain("Unknown config key");
  });

  it("unset removes a stored value", async () => {
    writeConfig({ apiKey: "x" }, tmpHome);
    const code = await runConfigCommand(["unset", "api-key"], tmpHome);
    expect(code).toBe(0);
    expect(stdout).toContain("Removed api-key");
    expect(readConfig(tmpHome).apiKey).toBeUndefined();
  });

  it("list shows the config path and masked values", async () => {
    writeConfig(
      { apiKey: "sk-ant-abc123xyz789", aiModel: "some-model" },
      tmpHome,
    );
    const code = await runConfigCommand(["list"], tmpHome);
    expect(code).toBe(0);
    expect(stdout).toContain("Config file:");
    expect(stdout).toContain("some-model");
    expect(stdout).not.toContain("abc123");
  });

  it("list notes when the env var is overriding the stored api key", async () => {
    process.env.ANTHROPIC_API_KEY = "env-value";
    writeConfig({ apiKey: "config-value" }, tmpHome);
    const code = await runConfigCommand(["list"], tmpHome);
    expect(code).toBe(0);
    expect(stdout).toContain("currently sourced from the ANTHROPIC_API_KEY");
  });

  it("path prints the config file location", async () => {
    const code = await runConfigCommand(["path"], tmpHome);
    expect(code).toBe(0);
    expect(stdout.trim()).toContain(".diagno");
    expect(stdout.trim()).toContain("config.json");
  });

  it("rejects an unknown action", async () => {
    const code = await runConfigCommand(["frobnicate"], tmpHome);
    expect(code).toBe(1);
    expect(stderr).toContain('Unknown config command "frobnicate"');
  });
});
