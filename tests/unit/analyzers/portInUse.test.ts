import { describe, it, expect } from "vitest";
import { portInUseAnalyzer } from "../../../src/analyzers/common/portInUse";
import { makeFailure } from "../../helpers/failureContext";
import { makeProject, makeCollected } from "../../helpers/projectContext";

const project = makeProject();
const collected = makeCollected();

describe("portInUseAnalyzer", () => {
  it("recognizes EADDRINUSE and extracts the port number", async () => {
    const failure = makeFailure({
      stderr: "Error: listen EADDRINUSE: address already in use :::3000\n",
    });

    expect(
      portInUseAnalyzer.canAnalyze({ failure, project, collected })
    ).toBe(true);

    const findings = await portInUseAnalyzer.analyze({
      failure,
      project,
      collected,
    });

    expect(findings).toHaveLength(1);
    expect(findings[0].title).toContain("3000");
    expect(
      findings[0].suggestedActions.some((a) => a.description.includes("3000"))
    ).toBe(true);
  });

  it("still produces a (lower-confidence) finding when no port number is present", async () => {
    const failure = makeFailure({ stderr: "Error: EADDRINUSE\n" });
    const findings = await portInUseAnalyzer.analyze({
      failure,
      project,
      collected,
    });

    expect(findings).toHaveLength(1);
    expect(findings[0].confidence).toBeLessThan(0.7);
  });

  it("does not fire on unrelated errors", () => {
    const failure = makeFailure({ stderr: "connection refused\n" });
    expect(
      portInUseAnalyzer.canAnalyze({ failure, project, collected })
    ).toBe(false);
  });
});
