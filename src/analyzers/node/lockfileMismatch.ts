import type { Analyzer, AnalyzerContext } from "../types";
import type { Finding } from "../../types/finding";
import type { PackageManager } from "../../types/project";

const LOCKFILE_TO_MANAGER: Record<string, PackageManager> = {
  "package-lock.json": "npm",
  "yarn.lock": "yarn",
  "pnpm-lock.yaml": "pnpm",
};

const MISMATCH_SYMPTOMS =
  /EUSAGE|lockfile.*(?:out of date|does not match|mismatch)|Your lockfile needs to be updated|frozen-lockfile/i;

function commandUsesManager(command: string[]): PackageManager | undefined {
  const bin = command[0]?.split("/").pop();
  if (bin === "npm" || bin === "npx") return "npm";
  if (bin === "yarn") return "yarn";
  if (bin === "pnpm") return "pnpm";
  return undefined;
}

export const lockfileMismatchAnalyzer: Analyzer = {
  id: "node-lockfile-mismatch",

  canAnalyze(context: AnalyzerContext): boolean {
    const { project, failure } = context;
    const multipleLockfiles = project.lockfiles.length > 1;
    const symptomatic = MISMATCH_SYMPTOMS.test(
      failure.stderr + failure.stdout
    );
    return multipleLockfiles || symptomatic;
  },

  async analyze(context: AnalyzerContext): Promise<Finding[]> {
    const { project, failure } = context;
    const findings: Finding[] = [];

    if (project.lockfiles.length > 1) {
      const managers = project.lockfiles.map((f) => LOCKFILE_TO_MANAGER[f]);
      findings.push({
        id: "multiple-lockfiles-present",
        analyzerId: this.id,
        title: "Multiple package-manager lockfiles present",
        severity: "warning",
        confidence: 0.8,
        explanation: `This project has more than one lockfile (${project.lockfiles.join(
          ", "
        )}), which correspond to different package managers (${managers.join(
          ", "
        )}). Mixing package managers can install inconsistent dependency trees and cause failures that only reproduce for some contributors.`,
        evidence: project.lockfiles.map((f) => ({
          description: `${f} is present`,
          source: f,
          passed: true,
        })),
        suggestedActions: [
          {
            description: `Pick one package manager for this project, delete the other lockfile(s), and reinstall.`,
          },
          {
            description: `Consider setting "packageManager" in package.json to make the choice explicit (used by Corepack).`,
          },
        ],
      });
    }

    const usedManager = commandUsesManager(failure.command);
    const singleLockfileManager =
      project.lockfiles.length === 1
        ? LOCKFILE_TO_MANAGER[project.lockfiles[0]]
        : undefined;

    if (
      usedManager &&
      singleLockfileManager &&
      usedManager !== singleLockfileManager
    ) {
      findings.push({
        id: "package-manager-command-mismatch",
        analyzerId: this.id,
        title: `Ran ${usedManager}, but this project uses ${singleLockfileManager}`,
        severity: "warning",
        confidence: 0.7,
        explanation: `The command used "${usedManager}", but the project's lockfile (${project.lockfiles[0]}) indicates it's managed with ${singleLockfileManager}. Running the wrong package manager can silently create a second lockfile or resolve different dependency versions.`,
        evidence: [
          {
            description: `command invoked "${usedManager}"`,
            source: "command",
            passed: true,
          },
          {
            description: `${project.lockfiles[0]} indicates ${singleLockfileManager} is the project's package manager`,
            source: project.lockfiles[0],
            passed: false,
          },
        ],
        suggestedActions: [
          { description: `Use ${singleLockfileManager} for this project instead.` },
        ],
      });
    }

    return findings;
  },
};
