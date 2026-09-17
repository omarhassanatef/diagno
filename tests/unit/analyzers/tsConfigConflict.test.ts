import { describe, it, expect } from "vitest";
import * as path from "path";
import { ProjectDetector } from "../../../src/detection/projectDetector";
import { ContextCollector } from "../../../src/context/contextCollector";
import { tsConfigConflictAnalyzer } from "../../../src/analyzers/typescript/tsConfigConflict";
import { makeFailure } from "../../helpers/failureContext";

const FIXTURE = path.resolve(__dirname, "../../fixtures/ts-config-conflict");
const detector = new ProjectDetector();
const collector = new ContextCollector();

describe("tsConfigConflictAnalyzer", () => {
  const project = detector.detect(FIXTURE);
  const collected = collector.collect(project);

  it("detects a broken 'extends' path", async () => {
    const failure = makeFailure({
      stderr: "error TS6053: File 'tsconfig.base.json' not found.\n",
    });

    expect(
      tsConfigConflictAnalyzer.canAnalyze({ failure, project, collected })
    ).toBe(true);

    const findings = await tsConfigConflictAnalyzer.analyze({
      failure,
      project,
      collected,
    });

    const extendsFinding = findings.find(
      (f) => f.id === "tsconfig-extends-not-found"
    );
    expect(extendsFinding).toBeDefined();
    expect(extendsFinding?.explanation).toContain("tsconfig.base.json");
  });

  it("recognizes known tsc config error codes", async () => {
    const failure = makeFailure({
      stderr: "error TS5023: Unknown compiler option 'fooBar'.\n",
    });

    const findings = await tsConfigConflictAnalyzer.analyze({
      failure,
      project,
      collected,
    });

    const codeFinding = findings.find((f) => f.id === "tsconfig-error-ts5023");
    expect(codeFinding).toBeDefined();
  });

  it("does not fire without TypeScript present", () => {
    const nonTsProject = { ...project, hasTypeScript: false };
    const failure = makeFailure({ stderr: "error TS5023: Unknown option\n" });
    expect(
      tsConfigConflictAnalyzer.canAnalyze({
        failure,
        project: nonTsProject,
        collected,
      })
    ).toBe(false);
  });
});
