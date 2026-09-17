import type { Analyzer, AnalyzerContext } from "../types";
import type { Finding } from "../../types/finding";

/** Common phrasing frameworks use when a required env var is absent.
 * Captures one or more comma/space separated variable names. */
const PATTERNS = [
  /Missing required env(?:ironment)? variables?:?\s*([A-Z0-9_,\s]+)/i,
  /([A-Z][A-Z0-9_]{2,})\s+is not defined/,
  /process\.env\.([A-Z][A-Z0-9_]{2,})\s+is (?:required|missing|undefined)/,
  /Environment variable ([A-Z][A-Z0-9_]{2,}) (?:is required|must be set|is missing)/i,
];

function extractVarNames(output: string): string[] {
  for (const pattern of PATTERNS) {
    const match = output.match(pattern);
    if (match) {
      return match[1]
        .split(/[,\s]+/)
        .map((s) => s.trim())
        .filter((s) => /^[A-Z][A-Z0-9_]*$/.test(s));
    }
  }
  return [];
}

export const missingEnvVarAnalyzer: Analyzer = {
  id: "missing-env-var",

  canAnalyze(context: AnalyzerContext): boolean {
    const output = context.failure.stderr + context.failure.stdout;
    return extractVarNames(output).length > 0;
  },

  async analyze(context: AnalyzerContext): Promise<Finding[]> {
    const { project, collected, failure } = context;
    const output = failure.stderr + failure.stdout;
    const varNames = extractVarNames(output);
    if (varNames.length === 0) return [];

    return varNames.map((varName) => {
      const declaredInEnvFile = collected.envKeys.includes(varName);

      const evidence: Finding["evidence"] = [
        {
          description: `output reports "${varName}" as missing/required`,
          source: "stderr/stdout",
          passed: true,
        },
        {
          description: project.hasEnvFile
            ? declaredInEnvFile
              ? `.env declares ${varName}`
              : `.env exists but does NOT declare ${varName}`
            : "no .env file was found in the project root",
          source: ".env",
          passed: declaredInEnvFile,
        },
      ];

      const explanation = declaredInEnvFile
        ? `"${varName}" is declared in .env but the failing command didn't see it -- likely because .env isn't being loaded (e.g. missing dotenv setup), or the command was run without the environment file sourced.`
        : `"${varName}" is required but isn't declared anywhere SIFT can see (.env is ${
            project.hasEnvFile ? "present but missing this key" : "not present"
          }).`;

      return {
        id: `missing-env-var-${varName.toLowerCase()}`,
        analyzerId: this.id,
        title: `Missing environment variable: ${varName}`,
        severity: "error" as const,
        confidence: declaredInEnvFile ? 0.55 : 0.65,
        explanation,
        evidence,
        suggestedActions: declaredInEnvFile
          ? [
              { description: `Confirm the command loads .env (e.g. via dotenv, or your process manager's env file support).` },
              { description: `Try running with the variable set inline: ${varName}=... <command>` },
            ]
          : [
              { description: `Add ${varName}=<value> to your .env file (never commit real secrets).` },
              { description: `Or export it in your shell/CI before running the command.` },
            ],
        // Values are never included -- only the fact that the key is
        // missing, per the blueprint's privacy rules.
      };
    });
  },
};
