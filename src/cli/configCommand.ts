import {
  getConfigPath,
  readConfig,
  updateConfig,
  maskSecret,
  resolveApiKey,
  type SiftConfig,
} from "../config/configStore";

/** Maps the user-facing key names to the internal config field names.
 * Both "api-key" and "apikey" are accepted since people type it both ways. */
const KEY_ALIASES: Record<string, keyof SiftConfig> = {
  "api-key": "apiKey",
  apikey: "apiKey",
  model: "aiModel",
};

const VALID_KEYS = Array.from(new Set(Object.values(KEY_ALIASES)));
const SECRET_FIELDS = new Set<keyof SiftConfig>(["apiKey"]);

const CONFIG_HELP = `sift config - manage local SIFT settings

Usage:
  sift config set <key> <value>   Store a value (e.g. your Anthropic API key)
  sift config get <key>           Show a stored value (secrets are masked)
  sift config unset <key>         Remove a stored value
  sift config list                Show all stored settings
  sift config path                Print the config file location
  sift config --help              Show this help message

Keys:
  api-key    Anthropic API key used for AI-assisted analysis
  model      Anthropic model to use (overrides the built-in default)

Flags:
  --reveal   Show secret values in full instead of masked (get/list only)

Precedence: the ANTHROPIC_API_KEY and SIFT_AI_MODEL environment variables,
when set, always take priority over values stored here.

Settings are stored in plain JSON at your config file path (see
'sift config path'), with owner-only file permissions. Treat it like any
other local credential file.
`;

function normalizeKey(raw: string | undefined): keyof SiftConfig | undefined {
  if (!raw) return undefined;
  return KEY_ALIASES[raw.toLowerCase()];
}

function displayValue(
  field: keyof SiftConfig,
  value: string | undefined,
  reveal: boolean
): string {
  if (value === undefined) return "(not set)";
  if (SECRET_FIELDS.has(field) && !reveal) return maskSecret(value);
  return value;
}

function unknownKeyMessage(raw: string): string {
  return `Unknown config key "${raw}". Valid keys: ${Array.from(
    new Set(Object.keys(KEY_ALIASES))
  ).join(", ")}`;
}

/**
 * Handles `sift config ...`. Returns the process exit code -- this never
 * runs a wrapped command, so it's kept entirely separate from the main
 * command-diagnosis flow in cli/index.ts.
 */
export async function runConfigCommand(
  args: string[],
  homeDir?: string
): Promise<number> {
  const [action, ...rest] = args;
  const reveal = rest.includes("--reveal");
  const positional = rest.filter((a) => a !== "--reveal");

  if (!action || action === "--help" || action === "-h") {
    process.stdout.write(CONFIG_HELP);
    return action ? 0 : 1;
  }

  switch (action) {
    case "set": {
      const [rawKey, ...valueParts] = positional;
      const field = normalizeKey(rawKey);
      const value = valueParts.join(" ");
      if (!field) {
        process.stderr.write(unknownKeyMessage(rawKey ?? "") + "\n");
        return 1;
      }
      if (!value) {
        process.stderr.write(`Usage: sift config set ${rawKey} <value>\n`);
        return 1;
      }

      updateConfig({ [field]: value }, homeDir);

      const envOverride = field === "apiKey" && process.env.ANTHROPIC_API_KEY;
      process.stdout.write(
        `Saved ${rawKey} = ${displayValue(field, value, reveal)}\n`
      );
      if (envOverride) {
        process.stdout.write(
          `Note: ANTHROPIC_API_KEY is currently set in your environment and will take priority over this stored value.\n`
        );
      }
      return 0;
    }

    case "get": {
      const field = normalizeKey(positional[0]);
      if (!field) {
        process.stderr.write(unknownKeyMessage(positional[0] ?? "") + "\n");
        return 1;
      }
      const config = readConfig(homeDir);
      process.stdout.write(
        `${positional[0]}: ${displayValue(field, config[field], reveal)}\n`
      );
      return 0;
    }

    case "unset": {
      const field = normalizeKey(positional[0]);
      if (!field) {
        process.stderr.write(unknownKeyMessage(positional[0] ?? "") + "\n");
        return 1;
      }
      updateConfig({ [field]: undefined }, homeDir);
      process.stdout.write(`Removed ${positional[0]}.\n`);
      return 0;
    }

    case "list": {
      const config = readConfig(homeDir);
      process.stdout.write(`Config file: ${getConfigPath(homeDir)}\n\n`);
      for (const field of VALID_KEYS) {
        const label = Object.keys(KEY_ALIASES).find(
          (k) => KEY_ALIASES[k] === field && !k.includes("apikey")
        )!;
        process.stdout.write(
          `${label}: ${displayValue(field, config[field], reveal)}\n`
        );
      }
      const { source } = resolveApiKey(homeDir);
      if (source === "env") {
        process.stdout.write(
          `\n(api-key is currently sourced from the ANTHROPIC_API_KEY environment variable, which overrides the value above)\n`
        );
      }
      return 0;
    }

    case "path": {
      process.stdout.write(getConfigPath(homeDir) + "\n");
      return 0;
    }

    default:
      process.stderr.write(`Unknown config command "${action}".\n\n`);
      process.stdout.write(CONFIG_HELP);
      return 1;
  }
}
