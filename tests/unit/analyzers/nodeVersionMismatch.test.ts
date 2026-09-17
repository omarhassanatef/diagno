import { describe, it, expect } from "vitest";
import * as path from "path";
import { ProjectDetector } from "../../../src/detection/projectDetector";
import { ContextCollector } from "../../../src/context/contextCollector";
import { nodeVersionMismatchAnalyzer } from "../../../src/analyzers/node/nodeVersionMismatch";
import { makeFailure } from "../../helpers/failureContext";

const FIXTURE = path.resolve(__dirname, "../../fixtures/node-version-mismatch");
const detector = new ProjectDetector();
const collector = new ContextCollector();

describe("nodeVersionMismatchAnalyzer", () => {
  const project = detector.detect(FIXTURE);
  const collected = collector.collect(project);

  it("fires when engines.node is unsatisfied and a version-sensitive symptom is present", async () => {
    const failure = makeFailure({
      stderr: "SyntaxError: Unexpected token '??='\n",
    });

    expect(
      nodeVersionMismatchAnalyzer.canAnalyze({ failure, project, collected })
    ).toBe(true);

    const findings = await nodeVersionMismatchAnalyzer.analyze({
      failure,
      project,
      collected,
    });

    expect(findings).toHaveLength(1);
    expect(findings[0].explanation).toContain("<=1.0.0");
    expect(findings[0].explanation).toContain(process.version);
  });

  it("does not fire without a version-sensitive symptom, even if the engine range is unsatisfied", () => {
    const failure = makeFailure({ stderr: "Some unrelated error\n" });
    expect(
      nodeVersionMismatchAnalyzer.canAnalyze({ failure, project, collected })
    ).toBe(false);
  });

  it("does not fire when no engines.node is declared", () => {
    const noEngineProject = { ...project, nodeEngineRange: undefined };
    const failure = makeFailure({ stderr: "SyntaxError: Unexpected token\n" });
    expect(
      nodeVersionMismatchAnalyzer.canAnalyze({
        failure,
        project: noEngineProject,
        collected,
      })
    ).toBe(false);
  });
});
