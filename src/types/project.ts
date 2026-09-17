export type PackageManager = "npm" | "yarn" | "pnpm" | "unknown";

/**
 * ProjectContext describes the static shape of the project SIFT is running
 * in: what kind of project it is, which tooling it uses, and where its
 * config files live. This is gathered once per run via ProjectDetector and
 * is deliberately shallow -- it answers "what is here", not "what broke".
 */
export interface ProjectContext {
  /** Absolute path to the detected project root (nearest ancestor with a package.json). */
  root: string;
  packageManager: PackageManager;
  /** True if more than one lockfile type was found at the root (a smell in itself). */
  lockfiles: string[];
  hasTypeScript: boolean;
  hasJest: boolean;
  hasVitest: boolean;
  hasDocker: boolean;
  hasEnvFile: boolean;
  /** Parsed package.json, if present and parseable. */
  packageJson?: Record<string, unknown>;
  /** engines.node range from package.json, if declared. */
  nodeEngineRange?: string;
  /** Absolute path to tsconfig.json, if present. */
  tsconfigPath?: string;
  /** Absolute path to a discovered Jest config file (or package.json if using the "jest" key). */
  jestConfigPath?: string;
}
