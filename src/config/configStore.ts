import * as fs from "fs";
import * as path from "path";
import * as os from "os";

/**
 * DiagnoConfig is deliberately tiny: just what's needed to enable the AI
 * fallback without an environment variable. It is stored as plain JSON at
 * ~/.diagno/config.json with owner-only file permissions (0o600) -- the same
 * trust model as most CLI tools that store an API key locally (gh, npm,
 * etc.). This is a convenience, not a secrets vault: anyone with access to
 * the user's account can read it, same as an exported env var would allow.
 */
export interface DiagnoConfig {
  apiKey?: string;
  aiModel?: string;
}

const CONFIG_DIR_NAME = ".diagno";
const CONFIG_FILE_NAME = "config.json";

export function getConfigDir(homeDir: string = os.homedir()): string {
  return path.join(homeDir, CONFIG_DIR_NAME);
}

export function getConfigPath(homeDir: string = os.homedir()): string {
  return path.join(getConfigDir(homeDir), CONFIG_FILE_NAME);
}

/** Reads the config file, returning an empty config if it doesn't exist or
 * can't be parsed -- a missing/corrupt config should never crash the CLI. */
export function readConfig(homeDir: string = os.homedir()): DiagnoConfig {
  try {
    const raw = fs.readFileSync(getConfigPath(homeDir), "utf8");
    const parsed = JSON.parse(raw);
    return typeof parsed === "object" && parsed !== null ? parsed : {};
  } catch {
    return {};
  }
}

/** Writes the full config, creating ~/.diagno if needed and restricting the
 * file to owner read/write only (best-effort -- some filesystems, notably
 * on Windows, don't enforce POSIX permission bits). */
export function writeConfig(
  config: DiagnoConfig,
  homeDir: string = os.homedir(),
): void {
  const dir = getConfigDir(homeDir);
  fs.mkdirSync(dir, { recursive: true });
  const filePath = getConfigPath(homeDir);
  fs.writeFileSync(filePath, JSON.stringify(config, null, 2) + "\n", {
    mode: 0o600,
  });
  try {
    fs.chmodSync(filePath, 0o600);
  } catch {
    // Best-effort; not fatal (e.g. unsupported on some filesystems).
  }
}

/** Merges a partial update into the existing config. Setting a field to
 * `undefined` removes it entirely (used for `diagno config unset`). */
export function updateConfig(
  patch: Partial<DiagnoConfig>,
  homeDir: string = os.homedir(),
): DiagnoConfig {
  const next: DiagnoConfig = { ...readConfig(homeDir), ...patch };
  for (const key of Object.keys(next) as (keyof DiagnoConfig)[]) {
    if (next[key] === undefined) delete next[key];
  }
  writeConfig(next, homeDir);
  return next;
}

export type ApiKeySource = "env" | "config" | "none";

/**
 * Resolves the API key to use, checking the environment variable first
 * (so CI/ephemeral shells always win) and falling back to the local config
 * file. Returning the source lets callers explain to the user where a key
 * came from (or why none was found).
 */
export function resolveApiKey(
  homeDir: string = os.homedir(),
  env: NodeJS.ProcessEnv = process.env,
): { value?: string; source: ApiKeySource } {
  if (env.ANTHROPIC_API_KEY) {
    return { value: env.ANTHROPIC_API_KEY, source: "env" };
  }
  const config = readConfig(homeDir);
  if (config.apiKey) {
    return { value: config.apiKey, source: "config" };
  }
  return { source: "none" };
}

/** Same precedence rule as resolveApiKey: env var wins, then config. */
export function resolveAiModel(
  homeDir: string = os.homedir(),
  env: NodeJS.ProcessEnv = process.env,
): string | undefined {
  return env.DIAGNO_AI_MODEL ?? readConfig(homeDir).aiModel;
}

/** Masks all but the last 4 characters of a secret for safe display,
 * e.g. "sk-ant-abc123xyz789" -> "****************789". Never returns the
 * key in full unless explicitly asked to reveal it. */
export function maskSecret(value: string): string {
  if (value.length <= 4) return "*".repeat(value.length);
  return "*".repeat(value.length - 4) + value.slice(-4);
}
