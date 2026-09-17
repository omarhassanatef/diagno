import { describe, it, expect } from "vitest";
import * as path from "path";
import { ProjectDetector } from "../../../src/detection/projectDetector";
import { ContextCollector } from "../../../src/context/contextCollector";
import { pathAliasMismatchAnalyzer } from "../../../src/analyzers/jest/pathAliasMismatch";
import { makeFailure } from "../../helpers/failureContext";

const FIXTURE = path.resolve(__dirname, "../../fixtures/jest-alias-mismatch");
const detector = new ProjectDetector();
const collector = new ContextCollector();

describe("pathAliasMismatchAnalyzer", () => {
  const project = detector.detect(FIXTURE);
  const collected = collector.collect(project);

  it("recognizes the blueprint's exact demo failure", () => {
    const failure = makeFailure({
      command: ["npm", "test"],
      stderr:
        "Cannot find module '@/modules/users' from 'src/users.test.ts'\n",
    });

    const context = { failure, project, collected };
    expect(pathAliasMismatchAnalyzer.canAnalyze(context)).toBe(true);
  });

  it("produces a high-confidence finding with correct evidence and a patch snippet", async () => {
    const failure = makeFailure({
      command: ["npm", "test"],
      stderr:
        "Cannot find module '@/modules/users' from 'src/users.test.ts'\n",
    });

    const findings = await pathAliasMismatchAnalyzer.analyze({
      failure,
      project,
      collected,
    });

    expect(findings).toHaveLength(1);
    const [finding] = findings;
    expect(finding.confidence).toBeGreaterThan(0.9);
    expect(finding.explanation).toContain("@/*");
    expect(finding.evidence.some((e) => e.description.includes("@/*") && e.passed)).toBe(true);
    expect(finding.evidence.some((e) => !e.passed)).toBe(true);
    expect(finding.patch?.snippet).toContain("moduleNameMapper");
    expect(finding.patch?.snippet).toContain("<rootDir>/src/$1");
  });

  it("computes a machine-applicable newContent that inserts moduleNameMapper into an existing exports object", async () => {
    const failure = makeFailure({
      stderr:
        "Cannot find module '@/modules/users' from 'src/users.test.ts'\n",
    });

    const findings = await pathAliasMismatchAnalyzer.analyze({
      failure,
      project,
      collected,
    });

    const patch = findings[0].patch;
    expect(patch?.beforeContent).toBe(collected.jestConfigContent);
    expect(patch?.newContent).toContain("moduleNameMapper");
    expect(patch?.newContent).toContain('"^@\\/(.*)$": "<rootDir>/src/$1"');
    // The rest of the original config must be preserved, not clobbered.
    expect(patch?.newContent).toContain("testEnvironment");
    // And it must still be valid enough to load as a CommonJS module.
    expect(() => new Function("module", "exports", patch!.newContent!)).not.toThrow();
  });

  it("inserts a new key into an already-present moduleNameMapper block, preserving existing entries", async () => {
    const collectedWithMapper = {
      ...collected,
      jestConfigContent: `module.exports = {
  moduleNameMapper: {
    "^lodash$": "<rootDir>/node_modules/lodash"
  }
};
`,
    };
    const failure = makeFailure({
      stderr:
        "Cannot find module '@/modules/users' from 'src/users.test.ts'\n",
    });

    const findings = await pathAliasMismatchAnalyzer.analyze({
      failure,
      project,
      collected: collectedWithMapper,
    });

    const patch = findings[0].patch;
    expect(patch?.newContent).toContain("^lodash$");
    expect(patch?.newContent).toContain('"^@\\/(.*)$": "<rootDir>/src/$1"');
  });

  it("proposes creating jest.config.js when no Jest config file exists at all", async () => {
    const noJestConfigProject = { ...project, jestConfigPath: undefined };
    const collectedNoJestConfig = { ...collected, jestConfigContent: undefined };
    const failure = makeFailure({
      stderr:
        "Cannot find module '@/modules/users' from 'src/users.test.ts'\n",
    });

    const findings = await pathAliasMismatchAnalyzer.analyze({
      failure,
      project: noJestConfigProject,
      collected: collectedNoJestConfig,
    });

    const patch = findings[0].patch;
    expect(patch?.beforeContent).toBeUndefined();
    expect(patch?.filePath.endsWith("jest.config.js")).toBe(true);
    expect(patch?.newContent).toContain("moduleNameMapper");
  });

  it("does not compute newContent for a non-JS Jest config it can't safely rewrite", async () => {
    const tsConfigProject = {
      ...project,
      jestConfigPath: path.join(project.root, "jest.config.ts"),
    };
    const collectedTsConfig = {
      ...collected,
      jestConfigContent: `import type { Config } from "jest";\nconst config: Config = {};\nexport default config;\n`,
    };
    const failure = makeFailure({
      stderr:
        "Cannot find module '@/modules/users' from 'src/users.test.ts'\n",
    });

    const findings = await pathAliasMismatchAnalyzer.analyze({
      failure,
      project: tsConfigProject,
      collected: collectedTsConfig,
    });

    // Still a valid, high-confidence finding with a human-readable snippet --
    // just not machine-applicable, since rewriting a .ts config safely isn't
    // something a simple textual patch can guarantee.
    expect(findings).toHaveLength(1);
    expect(findings[0].patch?.newContent).toBeUndefined();
    expect(findings[0].patch?.snippet).toContain("moduleNameMapper");
  });

  it("does not corrupt output when the replacement target contains a literal '$1' (regression)", async () => {
    // String.prototype.replace() treats "$1" in a replacement string as a
    // backreference. Our jest target template ("<rootDir>/src/$1") contains
    // a literal "$1" that must NOT be reinterpreted that way.
    const failure = makeFailure({
      stderr:
        "Cannot find module '@/modules/users' from 'src/users.test.ts'\n",
    });

    const findings = await pathAliasMismatchAnalyzer.analyze({
      failure,
      project,
      collected,
    });

    const newContent = findings[0].patch?.newContent ?? "";
    expect(newContent).toContain("<rootDir>/src/$1");
    expect(newContent).not.toContain("module.exports = {\"");
    expect(newContent).not.toContain("moduleNameMapper: {\"");
  });

  it("does not produce a finding when the unresolved import isn't a configured alias", async () => {
    // canAnalyze is a cheap pre-filter (any unresolved-from-Jest import);
    // analyze() does the real work of confirming it matches a tsconfig alias.
    const failure = makeFailure({
      stderr: "Cannot find module 'lodash' from 'src/x.ts'\n",
    });
    const context = { failure, project, collected };
    expect(pathAliasMismatchAnalyzer.canAnalyze(context)).toBe(true);

    const findings = await pathAliasMismatchAnalyzer.analyze(context);
    expect(findings).toHaveLength(0);
  });

  it("does not fire once the jest config already maps the alias", async () => {
    const fixedCollected = {
      ...collected,
      jestConfigContent: `module.exports = {
        moduleNameMapper: {
          "^@/(.*)$": "<rootDir>/src/$1"
        }
      };`,
    };
    const failure = makeFailure({
      stderr:
        "Cannot find module '@/modules/users' from 'src/users.test.ts'\n",
    });

    const findings = await pathAliasMismatchAnalyzer.analyze({
      failure,
      project,
      collected: fixedCollected,
    });

    expect(findings).toHaveLength(0);
  });
});
