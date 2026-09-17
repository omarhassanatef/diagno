import { describe, it, expect } from "vitest";
import * as path from "path";
import { ProjectDetector } from "../../../src/detection/projectDetector";
import { ContextCollector } from "../../../src/context/contextCollector";
import { missingEnvVarAnalyzer } from "../../../src/analyzers/common/missingEnvVar";
import { makeFailure } from "../../helpers/failureContext";

const FIXTURE = path.resolve(__dirname, "../../fixtures/missing-env-var");
const detector = new ProjectDetector();
const collector = new ContextCollector();

describe("missingEnvVarAnalyzer", () => {
  const project = detector.detect(FIXTURE);
  const collected = collector.collect(project);

  it("flags a variable that's required but absent from .env entirely", async () => {
    const failure = makeFailure({
      stderr: "Error: DATABASE_URL is not defined\n",
    });

    expect(
      missingEnvVarAnalyzer.canAnalyze({ failure, project, collected })
    ).toBe(true);

    const findings = await missingEnvVarAnalyzer.analyze({
      failure,
      project,
      collected,
    });

    expect(findings).toHaveLength(1);
    expect(findings[0].title).toContain("DATABASE_URL");
    expect(findings[0].evidence.find((e) => e.source === ".env")?.passed).toBe(false);
  });

  it("never includes the variable's value anywhere in the finding", async () => {
    const failure = makeFailure({
      stderr: "Missing required environment variable: OTHER_KEY\n",
    });

    const findings = await missingEnvVarAnalyzer.analyze({
      failure,
      project,
      collected,
    });

    const serialized = JSON.stringify(findings);
    expect(serialized).not.toContain("some-value");
  });

  it("does not fire on output with no recognizable env-var pattern", () => {
    const failure = makeFailure({ stderr: "connection refused\n" });
    expect(
      missingEnvVarAnalyzer.canAnalyze({ failure, project, collected })
    ).toBe(false);
  });
});
