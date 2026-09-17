import type { Analyzer, AnalyzerContext } from "../types";
import type { Finding } from "../../types/finding";
import { ContextCollector } from "../../context/contextCollector";

/** Matches Node/CommonJS and Jest's plain module-not-found errors.
 * Deliberately excludes Jest's "from '<file>'" variant, which is handled
 * by the more specific path-alias analyzer when it applies. */
const MODULE_NOT_FOUND = /Cannot find module '([^']+)'(?!\s+from\s+')/;
const ESM_MODULE_NOT_FOUND =
  /ERR_MODULE_NOT_FOUND.*Cannot find (?:package|module) '([^']+)'/s;

const collector = new ContextCollector();

function isBarePackageName(specifier: string): boolean {
  // Relative/absolute paths ("./foo", "../foo", "/foo") are not package
  // dependencies -- they're local files, which is a different failure mode.
  return !specifier.startsWith(".") && !specifier.startsWith("/");
}

function packageRootName(specifier: string): string {
  // Handle scoped packages ("@scope/pkg/sub") and subpath imports ("pkg/sub").
  if (specifier.startsWith("@")) {
    const parts = specifier.split("/");
    return parts.slice(0, 2).join("/");
  }
  return specifier.split("/")[0];
}

function installCommand(
  packageManager: AnalyzerContext["project"]["packageManager"]
): string {
  switch (packageManager) {
    case "yarn":
      return "yarn install";
    case "pnpm":
      return "pnpm install";
    case "npm":
    default:
      return "npm install";
  }
}

export const missingDependencyAnalyzer: Analyzer = {
  id: "node-missing-dependency",

  canAnalyze(context: AnalyzerContext): boolean {
    const output = context.failure.stderr + context.failure.stdout;
    return MODULE_NOT_FOUND.test(output) || ESM_MODULE_NOT_FOUND.test(output);
  },

  async analyze(context: AnalyzerContext): Promise<Finding[]> {
    const { project, failure } = context;
    const output = failure.stderr + failure.stdout;
    const match = output.match(MODULE_NOT_FOUND) ?? output.match(ESM_MODULE_NOT_FOUND);
    if (!match) return [];

    const specifier = match[1];
    if (!isBarePackageName(specifier)) return [];

    const pkgName = packageRootName(specifier);
    const deps = {
      ...((project.packageJson?.dependencies as
        | Record<string, string>
        | undefined) ?? {}),
      ...((project.packageJson?.devDependencies as
        | Record<string, string>
        | undefined) ?? {}),
    };
    const declaredInPackageJson = pkgName in deps;
    const installedOnDisk = collector.isInstalled(project, pkgName);

    const evidence: Finding["evidence"] = [
      {
        description: `stderr reports "Cannot find module '${specifier}'"`,
        source: "stderr",
        passed: true,
      },
      {
        description: declaredInPackageJson
          ? `package.json lists "${pkgName}" as a dependency`
          : `package.json does NOT list "${pkgName}" as a dependency`,
        source: "package.json",
        passed: declaredInPackageJson,
      },
      {
        description: installedOnDisk
          ? `node_modules/${pkgName} is present on disk`
          : `node_modules/${pkgName} is missing on disk`,
        source: "node_modules",
        passed: installedOnDisk,
      },
    ];

    if (declaredInPackageJson && !installedOnDisk) {
      return [
        {
          id: "missing-dependency-not-installed",
          analyzerId: this.id,
          title: `"${pkgName}" is declared but not installed`,
          severity: "error",
          confidence: 0.9,
          explanation: `"${pkgName}" is listed in package.json but isn't present in node_modules. This usually means dependencies were never installed, or node_modules was deleted/not restored (e.g. after a clean checkout or a lockfile change).`,
          evidence,
          suggestedActions: [
            { description: `Run \`${installCommand(project.packageManager)}\` to install dependencies.` },
          ],
        },
      ];
    }

    if (!declaredInPackageJson) {
      return [
        {
          id: "missing-dependency-not-declared",
          analyzerId: this.id,
          title: `"${pkgName}" is not a declared dependency`,
          severity: "error",
          confidence: 0.7,
          explanation: `"${pkgName}" is imported but is not declared in package.json at all. Either it was never added as a dependency, or it's a typo of another package name.`,
          evidence,
          suggestedActions: [
            {
              description: `If this is intentional, add it: \`${project.packageManager === "unknown" ? "npm" : project.packageManager} add ${pkgName}\` (or the equivalent install command).`,
            },
            { description: `Double-check "${pkgName}" isn't a typo of an existing dependency.` },
          ],
        },
      ];
    }

    // Declared and installed, yet still failing -- outside this analyzer's
    // confident territory (could be a version/resolution issue). Leave it
    // to other analyzers / AI in later phases rather than guessing.
    return [];
  },
};
