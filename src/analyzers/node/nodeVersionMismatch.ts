import * as semver from "semver";
import type { Analyzer, AnalyzerContext } from "../types";
import type { Finding } from "../../types/finding";

/** Symptoms that plausibly stem from running an unsupported Node version.
 * Kept broad on purpose -- this analyzer only fires a finding once the
 * engines.node range is confirmed unsatisfied, so a broad symptom match
 * here just decides whether it's worth checking at all. */
const VERSION_SENSITIVE_SYMPTOMS =
  /EBADENGINE|Unexpected token|ERR_REQUIRE_ESM|is not supported|SyntaxError|is not a function/;

export const nodeVersionMismatchAnalyzer: Analyzer = {
  id: "node-version-mismatch",

  canAnalyze(context: AnalyzerContext): boolean {
    const { project, failure } = context;
    if (!project.nodeEngineRange) return false;
    const output = failure.stderr + failure.stdout;
    return VERSION_SENSITIVE_SYMPTOMS.test(output);
  },

  async analyze(context: AnalyzerContext): Promise<Finding[]> {
    const { project } = context;
    const range = project.nodeEngineRange;
    if (!range) return [];

    const current = process.version; // e.g. "v20.11.0"
    const satisfies = semver.satisfies(current, range, {
      includePrerelease: true,
    });

    if (satisfies) return [];

    return [
      {
        id: "node-engine-mismatch",
        analyzerId: this.id,
        title: "Running Node version does not satisfy the project's engine requirement",
        severity: "error",
        confidence: 0.75,
        explanation: `package.json requires Node "${range}", but the Node version running this command is ${current}. Several failure symptoms (syntax errors, missing globals, ESM/CJS interop errors) can stem from running an unsupported Node version.`,
        evidence: [
          {
            description: `package.json engines.node requires "${range}"`,
            source: "package.json",
            passed: true,
          },
          {
            description: `current Node version is ${current}`,
            source: "process.version",
            passed: false,
          },
        ],
        suggestedActions: [
          {
            description: `Switch to a Node version matching "${range}" (e.g. via nvm: \`nvm install\` / \`nvm use\` if an .nvmrc is present).`,
          },
        ],
      },
    ];
  },
};
