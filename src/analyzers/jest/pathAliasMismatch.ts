import * as path from "path";
import type { Analyzer, AnalyzerContext } from "../types";
import type { Finding } from "../../types/finding";
import type { ProjectContext } from "../../types/project";

/** Matches Jest's module-resolution failure message, e.g.
 *  "Cannot find module '@/modules/users' from 'src/users.test.ts'" */
const JEST_UNRESOLVED_IMPORT =
  /Cannot find module '([^']+)' from '([^']+)'/;

interface TsPathsConfig {
  [alias: string]: string[];
}

function extractTsPaths(tsconfigContent: string): TsPathsConfig | undefined {
  try {
    // tsconfig.json commonly contains comments, which JSON.parse rejects.
    // Strip line and block comments conservatively before parsing.
    const stripped = tsconfigContent
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/(^|\s)\/\/.*$/gm, "");
    const parsed = JSON.parse(stripped);
    return parsed?.compilerOptions?.paths;
  } catch {
    return undefined;
  }
}

function aliasMatchesImport(alias: string, importPath: string): boolean {
  // Aliases look like "@/*" or "@utils/*"; convert to a prefix match.
  const prefix = alias.replace(/\*$/, "");
  return importPath.startsWith(prefix);
}

function hasModuleNameMapperForAlias(
  jestConfigContent: string,
  alias: string
): boolean {
  if (!/moduleNameMapper/.test(jestConfigContent)) return false;
  // Best-effort: check whether the alias's root segment (e.g. "@") also
  // appears inside the moduleNameMapper block. This avoids false negatives
  // when the block is present but the alias itself isn't covered by it.
  const rootSegment = alias.replace(/\/?\*$/, "").replace(/^\^/, "");
  const escaped = rootSegment.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const mapperBlockMatch = jestConfigContent.match(
    /moduleNameMapper\s*:\s*{([\s\S]*?)}/
  );
  if (!mapperBlockMatch) return false;
  return new RegExp(escaped).test(mapperBlockMatch[1]);
}

/**
 * Computes the full, updated Jest config file content with a new
 * moduleNameMapper entry added -- or undefined if the existing file's shape
 * isn't one we can confidently rewrite (e.g. an unrecognized export style).
 * This is deliberately conservative: an unrecognized shape means "propose
 * the snippet for the human to apply", never a guessed, possibly-broken edit.
 *
 * Uses manual slice-based insertion rather than String.replace()'s
 * replacement-string form: mapperEntry legitimately contains literal "$1"
 * text (from the Jest capture-group target, e.g. "<rootDir>/src/$1"), which
 * String.replace() would otherwise silently reinterpret as its own
 * backreference syntax and corrupt.
 */
function insertAfter(
  content: string,
  pattern: RegExp,
  insertText: string
): string | undefined {
  const match = content.match(pattern);
  if (!match || match.index === undefined) return undefined;
  const insertPos = match.index + match[0].length;
  return content.slice(0, insertPos) + insertText + content.slice(insertPos);
}

function computeUpdatedJestConfig(
  existingContent: string | undefined,
  mapperEntry: string
): string | undefined {
  if (existingContent === undefined) {
    // No Jest config file exists yet -- propose creating a minimal one.
    return `module.exports = {\n  moduleNameMapper: {\n    ${mapperEntry}\n  }\n};\n`;
  }

  if (/moduleNameMapper\s*:\s*{/.test(existingContent)) {
    // A moduleNameMapper block already exists; insert our entry as its
    // first key. (analyze() already confirmed the alias isn't in there.)
    return insertAfter(
      existingContent,
      /moduleNameMapper\s*:\s*{/,
      `\n    ${mapperEntry},`
    );
  }

  if (/module\.exports\s*=\s*{/.test(existingContent)) {
    // CommonJS export object with no moduleNameMapper yet -- add one.
    return insertAfter(
      existingContent,
      /module\.exports\s*=\s*{/,
      `\n  moduleNameMapper: {\n    ${mapperEntry}\n  },`
    );
  }

  // Unrecognized shape (e.g. `export default {...}`, a function-returning
  // config, TypeScript config file). Not confident enough to auto-rewrite.
  return undefined;
}

function resolveJestConfigTargetPath(project: ProjectContext): string {
  return project.jestConfigPath ?? path.join(project.root, "jest.config.js");
}

export const pathAliasMismatchAnalyzer: Analyzer = {
  id: "typescript-jest-path-alias-mismatch",

  canAnalyze(context: AnalyzerContext): boolean {
    const { project, collected, failure } = context;
    return Boolean(
      project.hasJest &&
        project.hasTypeScript &&
        collected.tsconfigContent &&
        JEST_UNRESOLVED_IMPORT.test(failure.stderr + failure.stdout)
    );
  },

  async analyze(context: AnalyzerContext): Promise<Finding[]> {
    const { project, collected, failure } = context;
    const combinedOutput = failure.stderr + failure.stdout;
    const match = combinedOutput.match(JEST_UNRESOLVED_IMPORT);
    if (!match || !collected.tsconfigContent) return [];

    const [, importPath, fromFile] = match;
    const paths = extractTsPaths(collected.tsconfigContent);
    if (!paths) return [];

    const matchingAlias = Object.keys(paths).find((alias) =>
      aliasMatchesImport(alias, importPath)
    );
    if (!matchingAlias) return [];

    const target = paths[matchingAlias]?.[0] ?? "?";
    const mapperCovers = collected.jestConfigContent
      ? hasModuleNameMapperForAlias(collected.jestConfigContent, matchingAlias)
      : false;

    if (mapperCovers) {
      // tsconfig and jest config already agree; this isn't the cause.
      return [];
    }

    const jestRegexAlias = matchingAlias
      .replace(/\*$/, "(.*)")
      .replace(/\//g, "\\/");
    const jestTargetTemplate = `<rootDir>/${target.replace(/\*$/, "$1")}`;
    const mapperEntry = `"^${jestRegexAlias}$": "${jestTargetTemplate}"`;

    const targetPath = resolveJestConfigTargetPath(project);
    // Only a config file we can textually parse as JS gets an auto-applicable
    // patch (e.g. not jest.config.json/.ts, where this simple regex rewrite
    // isn't safe). package.json's "jest" key is also excluded -- rewriting
    // it risks corrupting unrelated JSON.
    const isRewritableJsConfig =
      !project.jestConfigPath || /jest\.config\.js$/.test(project.jestConfigPath);

    const newContent = isRewritableJsConfig
      ? computeUpdatedJestConfig(collected.jestConfigContent, mapperEntry)
      : undefined;

    const finding: Finding = {
      id: "ts-jest-path-alias-mismatch",
      analyzerId: this.id,
      title: "Jest cannot resolve a TypeScript path alias",
      severity: "error",
      confidence: 0.96,
      explanation: `Jest cannot resolve the ${matchingAlias} import alias. tsconfig.json defines it for TypeScript, but Jest's moduleNameMapper has no matching entry, so Jest's own module resolver -- which does not read tsconfig paths -- fails.`,
      evidence: [
        {
          description: `tsconfig.json defines ${matchingAlias} → ${target}`,
          source: "tsconfig.json",
          passed: true,
        },
        {
          description: `failing import uses ${importPath} (from ${fromFile})`,
          source: "stderr",
          passed: true,
        },
        {
          description: collected.jestConfigContent
            ? "jest config has no matching moduleNameMapper entry"
            : "no Jest config file was found to check for moduleNameMapper",
          source: "jest config",
          passed: false,
        },
      ],
      suggestedActions: [
        {
          description:
            "Add a moduleNameMapper entry to your Jest config mirroring the tsconfig path alias.",
        },
      ],
      patch: {
        filePath: targetPath,
        description: "Add a moduleNameMapper entry for the alias",
        snippet: `moduleNameMapper: {\n  ${mapperEntry}\n}`,
        beforeContent: collected.jestConfigContent,
        newContent,
      },
    };

    return [finding];
  },
};

