import * as fs from "fs";
import * as path from "path";
import type { PackageManager, ProjectContext } from "../types/project";

const LOCKFILES: Record<string, PackageManager> = {
  "package-lock.json": "npm",
  "yarn.lock": "yarn",
  "pnpm-lock.yaml": "pnpm",
};

const JEST_CONFIG_NAMES = [
  "jest.config.js",
  "jest.config.ts",
  "jest.config.mjs",
  "jest.config.cjs",
  "jest.config.json",
];

const VITEST_CONFIG_NAMES = [
  "vitest.config.js",
  "vitest.config.ts",
  "vitest.config.mjs",
  "vitest.config.cjs",
];

const DOCKER_FILE_NAMES = [
  "Dockerfile",
  "docker-compose.yml",
  "docker-compose.yaml",
  "compose.yml",
  "compose.yaml",
];

function readJsonSafe(filePath: string): Record<string, unknown> | undefined {
  try {
    const raw = fs.readFileSync(filePath, "utf8");
    return JSON.parse(raw) as Record<string, unknown>;
  } catch {
    return undefined;
  }
}

function findFirstExisting(dir: string, names: string[]): string | undefined {
  for (const name of names) {
    const candidate = path.join(dir, name);
    if (fs.existsSync(candidate)) return candidate;
  }
  return undefined;
}

/**
 * ProjectDetector walks upward from a starting directory looking for the
 * nearest package.json (mirroring how npm/node resolve a project root), then
 * inspects that directory for the tooling signals analyzers need: lockfiles,
 * TypeScript, Jest/Vitest, Docker, and a .env file.
 *
 * It never reads .env *values* -- only whether the file exists. Reading key
 * names (not values) is left to the ContextCollector, which is explicit
 * about what it exposes.
 */
export class ProjectDetector {
  detect(startDir: string): ProjectContext {
    const root = this.findProjectRoot(startDir) ?? startDir;

    const lockfiles = Object.keys(LOCKFILES).filter((name) =>
      fs.existsSync(path.join(root, name))
    );

    const packageJsonPath = path.join(root, "package.json");
    const packageJson = fs.existsSync(packageJsonPath)
      ? readJsonSafe(packageJsonPath)
      : undefined;

    const deps = {
      ...(packageJson?.dependencies as Record<string, string> | undefined),
      ...(packageJson?.devDependencies as
        | Record<string, string>
        | undefined),
    };

    const tsconfigPath = fs.existsSync(path.join(root, "tsconfig.json"))
      ? path.join(root, "tsconfig.json")
      : undefined;

    const jestConfigPath =
      findFirstExisting(root, JEST_CONFIG_NAMES) ??
      (packageJson && "jest" in packageJson ? packageJsonPath : undefined);

    const vitestConfigPath = findFirstExisting(root, VITEST_CONFIG_NAMES);

    const hasDocker = DOCKER_FILE_NAMES.some((name) =>
      fs.existsSync(path.join(root, name))
    );

    const engines = packageJson?.engines as
      | Record<string, string>
      | undefined;

    const packageManager = this.resolvePackageManager(lockfiles, packageJson);

    return {
      root,
      packageManager,
      lockfiles,
      hasTypeScript: Boolean(tsconfigPath) || "typescript" in deps,
      hasJest: Boolean(jestConfigPath) || "jest" in deps,
      hasVitest: Boolean(vitestConfigPath) || "vitest" in deps,
      hasDocker,
      hasEnvFile: fs.existsSync(path.join(root, ".env")),
      packageJson,
      nodeEngineRange: engines?.node,
      tsconfigPath,
      jestConfigPath,
    };
  }

  private findProjectRoot(startDir: string): string | undefined {
    let current = path.resolve(startDir);

    // eslint-disable-next-line no-constant-condition
    while (true) {
      if (fs.existsSync(path.join(current, "package.json"))) {
        return current;
      }
      const parent = path.dirname(current);
      if (parent === current) return undefined;
      current = parent;
    }
  }

  private resolvePackageManager(
    lockfiles: string[],
    packageJson: Record<string, unknown> | undefined
  ): PackageManager {
    const declared = packageJson?.packageManager as string | undefined;
    if (declared) {
      if (declared.startsWith("yarn")) return "yarn";
      if (declared.startsWith("pnpm")) return "pnpm";
      if (declared.startsWith("npm")) return "npm";
    }

    if (lockfiles.length === 1) {
      return LOCKFILES[lockfiles[0]];
    }

    // Multiple or zero lockfiles: ambiguous. Analyzers that care about this
    // ambiguity (lockfile mismatch) look at `lockfiles` directly.
    return lockfiles.length > 1 ? LOCKFILES[lockfiles[0]] : "unknown";
  }
}
