import type { ProjectContext } from "../../src/types/project";
import type { CollectedContext } from "../../src/context/types";

export function makeProject(overrides: Partial<ProjectContext> = {}): ProjectContext {
  return {
    root: process.cwd(),
    packageManager: "npm",
    lockfiles: ["package-lock.json"],
    hasTypeScript: false,
    hasJest: false,
    hasVitest: false,
    hasDocker: false,
    hasEnvFile: false,
    ...overrides,
  };
}

export function makeCollected(overrides: Partial<CollectedContext> = {}): CollectedContext {
  return {
    dockerFiles: [],
    envKeys: [],
    ...overrides,
  };
}
