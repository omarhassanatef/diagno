/**
 * redactSecrets is the privacy boundary between locally-collected context
 * (stdout/stderr, file contents) and anything sent to an AI provider. It is
 * intentionally conservative: when in doubt, redact. False positives (over-
 * redacting) are cheap; false negatives (leaking a real secret) are not.
 *
 * This is pattern-based and best-effort, not a guarantee -- it complements,
 * but does not replace, ContextCollector's stricter rule of simply never
 * reading full .env files or other credential stores in the first place.
 */

interface RedactionRule {
  name: string;
  pattern: RegExp;
  replacement: string | ((match: string, ...groups: string[]) => string);
}

const RULES: RedactionRule[] = [
  {
    name: "private-key-block",
    pattern: /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g,
    replacement: "[REDACTED:PRIVATE_KEY]",
  },
  {
    name: "aws-access-key-id",
    pattern: /\bAKIA[0-9A-Z]{16}\b/g,
    replacement: "[REDACTED:AWS_ACCESS_KEY_ID]",
  },
  {
    name: "jwt",
    pattern: /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/g,
    replacement: "[REDACTED:JWT]",
  },
  {
    name: "bearer-token",
    pattern: /\bBearer\s+[A-Za-z0-9\-_.=]{8,}/gi,
    replacement: "Bearer [REDACTED:TOKEN]",
  },
  {
    name: "generic-key-value-assignment",
    // Matches KEY=value or "key": "value" style assignments where the key
    // name suggests a credential, in code, config, or shell-style output.
    pattern:
      /((?:api[_-]?key|secret|token|password|passwd|pwd|access[_-]?key|private[_-]?key|credential)s?\s*[:=]\s*)(['"]?)([^\s'",;]{4,})(\2)/gi,
    replacement: (_match, prefix: string, quote: string, value: string) => {
      // Don't re-redact something another (more specific) rule already
      // replaced earlier in this same pass, e.g. "token: [REDACTED:JWT]".
      if (value.startsWith("[REDACTED")) return _match;
      return `${prefix}${quote}[REDACTED]${quote}`;
    },
  },
  {
    name: "dotenv-style-secret-line",
    // Matches ENV_VAR_NAME=value lines where the variable name suggests a
    // credential (as opposed to e.g. PORT=3000, which is fine to keep).
    pattern:
      /^([A-Z][A-Z0-9_]*(?:SECRET|TOKEN|KEY|PASSWORD|PWD|CREDENTIAL)[A-Z0-9_]*)\s*=\s*(.+)$/gm,
    replacement: (_match, name: string) => `${name}=[REDACTED]`,
  },
];

export interface RedactionResult {
  text: string;
  redactionCount: number;
}

export function redactSecrets(input: string): RedactionResult {
  let text = input;
  let redactionCount = 0;

  for (const rule of RULES) {
    text = text.replace(rule.pattern, (...args: unknown[]) => {
      redactionCount++;
      const match = args[0] as string;
      if (typeof rule.replacement === "string") return rule.replacement;
      // args: [match, ...capture groups, offset, fullString]. Strip the
      // trailing offset/fullString before handing groups to the callback.
      const groups = args.slice(1, -2) as string[];
      return rule.replacement(match, ...groups);
    });
  }

  return { text, redactionCount };
}

/** Convenience for redacting a whole set of named text blobs at once
 * (e.g. { stdout, stderr, "tsconfig.json": ... }), returning the same
 * shape back with every value redacted. */
export function redactAll<T extends Record<string, string | undefined>>(
  blobs: T
): T {
  const result = {} as T;
  for (const [key, value] of Object.entries(blobs)) {
    result[key as keyof T] = (
      value === undefined ? undefined : redactSecrets(value).text
    ) as T[keyof T];
  }
  return result;
}
