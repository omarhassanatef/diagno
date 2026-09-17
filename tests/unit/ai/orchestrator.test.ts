import { describe, it, expect } from "vitest";
import {
  buildAnalysisInput,
  runAiAnalysis,
} from "../../../src/ai/orchestrator";
import type { LLMProvider } from "../../../src/ai/provider";
import type { AnalysisInput, AnalysisResult } from "../../../src/ai/schemas";
import { makeFailure } from "../../helpers/failureContext";
import { makeProject, makeCollected } from "../../helpers/projectContext";

function fakeProvider(
  handler: (input: AnalysisInput) => AnalysisResult
): LLMProvider {
  return {
    id: "fake:test-model",
    async analyze(input) {
      return handler(input);
    },
  };
}

const sampleResult: AnalysisResult = {
  summary: "Test failed due to X",
  rootCause: "X is misconfigured",
  confidence: 0.6,
  evidence: ["some evidence"],
  assumptions: ["an assumption"],
  actions: ["do this"],
};

describe("buildAnalysisInput", () => {
  it("redacts secrets out of stdout/stderr before building input", () => {
    const project = makeProject();
    const collected = makeCollected();
    const failure = makeFailure({
      stderr: "AWS_ACCESS_KEY_ID=AKIAIOSFODNN7EXAMPLE\nreal error text",
    });

    const input = buildAnalysisInput({ failure, project, collected }, []);
    expect(input.stderr).not.toContain("AKIAIOSFODNN7EXAMPLE");
    expect(input.stderr).toContain("real error text");
  });

  it("includes relevant file contents with paths relative to the project root", () => {
    const project = makeProject({
      root: "/repo",
      tsconfigPath: "/repo/tsconfig.json",
    });
    const collected = makeCollected({
      tsconfigContent: '{"compilerOptions": {}}',
    });
    const failure = makeFailure();

    const input = buildAnalysisInput({ failure, project, collected }, []);
    expect(input.relevantFiles).toEqual([
      { path: "tsconfig.json", content: '{"compilerOptions": {}}' },
    ]);
  });

  it("carries forward deterministic findings as titled facts", () => {
    const project = makeProject();
    const collected = makeCollected();
    const failure = makeFailure();

    const input = buildAnalysisInput({ failure, project, collected }, [
      {
        id: "f1",
        analyzerId: "a1",
        title: "Something suspicious",
        severity: "warning",
        confidence: 0.4,
        evidence: [],
        explanation: "explanation text",
        suggestedActions: [],
      },
    ]);

    expect(input.deterministicFindings).toEqual([
      { title: "Something suspicious", confidence: 0.4, explanation: "explanation text" },
    ]);
  });

  it("truncates very long output, keeping the most recent (tail) content", () => {
    const project = makeProject();
    const collected = makeCollected();
    const longOutput = "x".repeat(10000) + "IMPORTANT_TAIL_MARKER";
    const failure = makeFailure({ stdout: longOutput });

    const input = buildAnalysisInput({ failure, project, collected }, []);
    expect(input.stdout.length).toBeLessThan(longOutput.length);
    expect(input.stdout).toContain("IMPORTANT_TAIL_MARKER");
  });
});

describe("runAiAnalysis", () => {
  it("returns ok:true with the provider's validated result", async () => {
    const project = makeProject();
    const collected = makeCollected();
    const failure = makeFailure({ stderr: "some ambiguous failure" });
    const provider = fakeProvider(() => sampleResult);

    const outcome = await runAiAnalysis({ failure, project, collected }, [], provider);

    expect(outcome.ok).toBe(true);
    if (outcome.ok) {
      expect(outcome.result.summary).toBe(sampleResult.summary);
      expect(outcome.providerId).toBe("fake:test-model");
    }
  });

  it("degrades gracefully (ok:false) when the provider throws", async () => {
    const project = makeProject();
    const collected = makeCollected();
    const failure = makeFailure();
    const provider: LLMProvider = {
      id: "fake:broken",
      async analyze() {
        throw new Error("network exploded");
      },
    };

    const outcome = await runAiAnalysis({ failure, project, collected }, [], provider);

    expect(outcome.ok).toBe(false);
    if (!outcome.ok) {
      expect(outcome.error).toContain("network exploded");
    }
  });
});
