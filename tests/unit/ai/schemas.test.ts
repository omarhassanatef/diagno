import { describe, it, expect } from "vitest";
import { AnalysisResultSchema, AnalysisInputSchema } from "../../../src/ai/schemas";

describe("AnalysisResultSchema", () => {
  it("accepts a well-formed result", () => {
    const result = AnalysisResultSchema.safeParse({
      summary: "The test failed due to a missing config value.",
      rootCause: "config.json is missing the 'apiUrl' field.",
      confidence: 0.8,
      evidence: ["config.json has no apiUrl key"],
      assumptions: ["the app reads config.json at startup"],
      actions: ["Add \"apiUrl\" to config.json"],
    });
    expect(result.success).toBe(true);
  });

  it("rejects a confidence outside 0..1", () => {
    const result = AnalysisResultSchema.safeParse({
      summary: "x",
      rootCause: "y",
      confidence: 1.5,
    });
    expect(result.success).toBe(false);
  });

  it("rejects a missing required field", () => {
    const result = AnalysisResultSchema.safeParse({
      summary: "x",
      confidence: 0.5,
    });
    expect(result.success).toBe(false);
  });

  it("defaults array fields to empty when omitted", () => {
    const result = AnalysisResultSchema.parse({
      summary: "x",
      rootCause: "y",
      confidence: 0.5,
    });
    expect(result.evidence).toEqual([]);
    expect(result.assumptions).toEqual([]);
    expect(result.actions).toEqual([]);
  });

  it("accepts an optional patchProposal", () => {
    const result = AnalysisResultSchema.safeParse({
      summary: "x",
      rootCause: "y",
      confidence: 0.9,
      patchProposal: {
        filePath: "src/config.ts",
        description: "add missing field",
        snippet: "apiUrl: 'https://example.com'",
      },
    });
    expect(result.success).toBe(true);
  });
});

describe("AnalysisInputSchema", () => {
  it("accepts a minimal valid input", () => {
    const result = AnalysisInputSchema.safeParse({
      command: ["npm", "test"],
      exitCode: 1,
      signal: null,
      stdout: "",
      stderr: "some error",
      project: {
        packageManager: "npm",
        hasTypeScript: true,
        hasJest: true,
        hasVitest: false,
        hasDocker: false,
      },
      relevantFiles: [],
      deterministicFindings: [],
    });
    expect(result.success).toBe(true);
  });
});
