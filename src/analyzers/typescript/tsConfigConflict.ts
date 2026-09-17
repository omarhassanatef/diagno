import * as fs from "fs";
import * as path from "path";
import type { Analyzer, AnalyzerContext } from "../types";
import type { Finding } from "../../types/finding";

/** A small dictionary of tsc diagnostic codes that indicate a config
 * problem (as opposed to an ordinary type error in application code). */
const KNOWN_CONFIG_ERROR_CODES: Record<string, string> = {
  TS5023: "An unknown compiler option was used in tsconfig.json.",
  TS5024: "A compiler option was given an invalid value in tsconfig.json.",
  TS6053: "A file referenced by tsconfig.json's \"extends\" could not be found.",
  TS18003: "No input files matched tsconfig.json's \"include\"/\"files\" settings.",
  TS6059: "A file is not under the \"rootDir\" specified in tsconfig.json.",
  TS5095: "The compiler option combination is not currently supported.",
  TS5069: "Two compiler options in tsconfig.json cannot be used together.",
};

const TS_ERROR_PATTERN = /error (TS\d+):\s*(.+)/;

function extendsPathIsBroken(
  tsconfigPath: string,
  tsconfigContent: string
): string | undefined {
  try {
    const stripped = tsconfigContent
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/(^|\s)\/\/.*$/gm, "");
    const parsed = JSON.parse(stripped);
    const extendsValue: string | undefined = parsed.extends;
    if (!extendsValue) return undefined;

    // Only resolve relative/absolute extends paths deterministically here;
    // package-based extends (e.g. "@tsconfig/node18") would need a
    // node_modules resolution pass, which we don't attempt in Phase 1.
    if (!extendsValue.startsWith(".") && !extendsValue.startsWith("/")) {
      return undefined;
    }

    const baseDir = path.dirname(tsconfigPath);
    const candidate = extendsValue.endsWith(".json")
      ? path.join(baseDir, extendsValue)
      : path.join(baseDir, `${extendsValue}.json`);

    return fs.existsSync(candidate) ? undefined : extendsValue;
  } catch {
    return undefined;
  }
}

export const tsConfigConflictAnalyzer: Analyzer = {
  id: "typescript-config-conflict",

  canAnalyze(context: AnalyzerContext): boolean {
    const { project, collected, failure } = context;
    if (!project.hasTypeScript || !collected.tsconfigContent) return false;
    const output = failure.stderr + failure.stdout;
    return (
      TS_ERROR_PATTERN.test(output) ||
      Boolean(
        project.tsconfigPath &&
          extendsPathIsBroken(project.tsconfigPath, collected.tsconfigContent)
      )
    );
  },

  async analyze(context: AnalyzerContext): Promise<Finding[]> {
    const { project, collected, failure } = context;
    if (!collected.tsconfigContent || !project.tsconfigPath) return [];

    const findings: Finding[] = [];
    const output = failure.stderr + failure.stdout;

    const brokenExtends = extendsPathIsBroken(
      project.tsconfigPath,
      collected.tsconfigContent
    );
    if (brokenExtends) {
      findings.push({
        id: "tsconfig-extends-not-found",
        analyzerId: this.id,
        title: `tsconfig.json extends a base config that can't be found`,
        severity: "error",
        confidence: 0.85,
        explanation: `tsconfig.json has "extends": "${brokenExtends}", but no matching file was found relative to tsconfig.json. TypeScript will fail before it can compile anything.`,
        evidence: [
          {
            description: `tsconfig.json declares extends: "${brokenExtends}"`,
            source: "tsconfig.json",
            passed: true,
          },
          {
            description: `no file resolving "${brokenExtends}" exists relative to tsconfig.json`,
            source: "filesystem",
            passed: false,
          },
        ],
        suggestedActions: [
          { description: `Fix the "extends" path in tsconfig.json, or restore the missing base config file.` },
        ],
      });
    }

    const codeMatch = output.match(TS_ERROR_PATTERN);
    if (codeMatch) {
      const [, code, message] = codeMatch;
      const knownExplanation = KNOWN_CONFIG_ERROR_CODES[code];
      if (knownExplanation) {
        findings.push({
          id: `tsconfig-error-${code.toLowerCase()}`,
          analyzerId: this.id,
          title: `TypeScript configuration error (${code})`,
          severity: "error",
          confidence: 0.8,
          explanation: `${knownExplanation} tsc reported: "${message.trim()}"`,
          evidence: [
            {
              description: `tsc reported ${code}: ${message.trim()}`,
              source: "stderr",
              passed: true,
            },
          ],
          suggestedActions: [
            { description: "Review tsconfig.json's compilerOptions for the setting referenced in the error." },
          ],
        });
      }
    }

    return findings;
  },
};
