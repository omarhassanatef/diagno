import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import {
  readConfig,
  writeConfig,
  updateConfig,
  getConfigPath,
  getConfigDir,
  resolveApiKey,
  resolveAiModel,
  maskSecret,
} from "../../../src/config/configStore";

let tmpHome: string;

beforeEach(() => {
  tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), "sift-config-test-"));
});

afterEach(() => {
  fs.rmSync(tmpHome, { recursive: true, force: true });
});

describe("configStore", () => {
  it("returns an empty config when no file exists yet", () => {
    expect(readConfig(tmpHome)).toEqual({});
  });

  it("writes and reads back a config", () => {
    writeConfig({ apiKey: "sk-test-123" }, tmpHome);
    expect(readConfig(tmpHome)).toEqual({ apiKey: "sk-test-123" });
  });

  it("creates the config directory if it doesn't exist", () => {
    expect(fs.existsSync(getConfigDir(tmpHome))).toBe(false);
    writeConfig({ apiKey: "x" }, tmpHome);
    expect(fs.existsSync(getConfigDir(tmpHome))).toBe(true);
  });

  it("restricts the config file to owner-only permissions", () => {
    writeConfig({ apiKey: "x" }, tmpHome);
    const mode = fs.statSync(getConfigPath(tmpHome)).mode & 0o777;
    expect(mode).toBe(0o600);
  });

  it("returns an empty config gracefully if the file is corrupt", () => {
    fs.mkdirSync(getConfigDir(tmpHome), { recursive: true });
    fs.writeFileSync(getConfigPath(tmpHome), "{ not valid json");
    expect(readConfig(tmpHome)).toEqual({});
  });

  it("updateConfig merges a partial patch into the existing config", () => {
    writeConfig({ apiKey: "x" }, tmpHome);
    const result = updateConfig({ aiModel: "some-model" }, tmpHome);
    expect(result).toEqual({ apiKey: "x", aiModel: "some-model" });
    expect(readConfig(tmpHome)).toEqual({ apiKey: "x", aiModel: "some-model" });
  });

  it("updateConfig with an undefined value removes that key entirely", () => {
    writeConfig({ apiKey: "x", aiModel: "y" }, tmpHome);
    const result = updateConfig({ apiKey: undefined }, tmpHome);
    expect(result).toEqual({ aiModel: "y" });
    expect(Object.keys(readConfig(tmpHome))).not.toContain("apiKey");
  });

  describe("resolveApiKey", () => {
    it("prefers the environment variable over the stored config", () => {
      writeConfig({ apiKey: "from-config" }, tmpHome);
      const result = resolveApiKey(tmpHome, { ANTHROPIC_API_KEY: "from-env" });
      expect(result).toEqual({ value: "from-env", source: "env" });
    });

    it("falls back to the stored config when no env var is set", () => {
      writeConfig({ apiKey: "from-config" }, tmpHome);
      const result = resolveApiKey(tmpHome, {});
      expect(result).toEqual({ value: "from-config", source: "config" });
    });

    it("returns source 'none' when neither is set", () => {
      const result = resolveApiKey(tmpHome, {});
      expect(result).toEqual({ source: "none" });
    });
  });

  describe("resolveAiModel", () => {
    it("prefers SIFT_AI_MODEL over the stored config", () => {
      writeConfig({ aiModel: "config-model" }, tmpHome);
      expect(resolveAiModel(tmpHome, { SIFT_AI_MODEL: "env-model" })).toBe(
        "env-model"
      );
    });

    it("falls back to the stored config", () => {
      writeConfig({ aiModel: "config-model" }, tmpHome);
      expect(resolveAiModel(tmpHome, {})).toBe("config-model");
    });

    it("returns undefined when neither is set", () => {
      expect(resolveAiModel(tmpHome, {})).toBeUndefined();
    });
  });

  describe("maskSecret", () => {
    it("keeps only the last 4 characters visible", () => {
      const secret = "sk-ant-abc123xyz789";
      const masked = maskSecret(secret);
      expect(masked.length).toBe(secret.length);
      expect(masked.endsWith("z789")).toBe(true);
      expect(masked).not.toContain("abc123");
    });

    it("masks entirely when 4 characters or fewer", () => {
      expect(maskSecret("abcd")).toBe("****");
      expect(maskSecret("ab")).toBe("**");
    });
  });
});
