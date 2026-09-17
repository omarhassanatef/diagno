import { describe, it, expect } from "vitest";
import * as path from "path";
import { ProjectDetector } from "../../src/detection/projectDetector";
import { ContextCollector } from "../../src/context/contextCollector";
import { runAnalyzers } from "../../src/analyzers/orchestrator";
import { makeFailure } from "../helpers/failureContext";
import type { Analyzer } from "../../src/analyzers/types";

const FIXTURE = path.resolve(__dirname, "../fixtures/jest-alias-mismatch");
const detector = new ProjectDetector();
const collector = new ContextCollector();

describe("runAnalyzers", () => {
  it("returns findings sorted by descending confidence", async () => {
    const project = detector.detect(FIXTURE);
    const collected = collector.collect(project);
    const failure = makeFailure({
      command: ["npm", "test"],
      stderr: "Cannot find module '@/modules/users' from 'src/users.test.ts'\n",
    });

    const findings = await runAnalyzers({ failure, project, collected });

    expect(findings.length).toBeGreaterThan(0);
    for (let i = 1; i < findings.length; i++) {
      expect(findings[i - 1].confidence).toBeGreaterThanOrEqual(
        findings[i].confidence
      );
    }
  });

  it("isolates a misbehaving analyzer instead of crashing the whole run", async () => {
    const project = detector.detect(FIXTURE);
    const collected = collector.collect(project);
    const failure = makeFailure({ stderr: "irrelevant output\n" });

    const brokenAnalyzer: Analyzer = {
      id: "broken",
      canAnalyze: () => {
        throw new Error("boom");
      },
      analyze: async () => [],
    };

    const findings = await runAnalyzers(
      { failure, project, collected },
      [brokenAnalyzer]
    );

    expect(findings).toEqual([]);
  });

  it("returns no findings for a clean failure with no matching analyzers", async () => {
    const project = detector.detect(FIXTURE);
    const collected = collector.collect(project);
    const failure = makeFailure({ stderr: "some totally generic assertion failure\n" });

    const findings = await runAnalyzers({ failure, project, collected });
    expect(findings).toEqual([]);
  });
});
