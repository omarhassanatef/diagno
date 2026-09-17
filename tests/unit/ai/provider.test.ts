import { describe, it, expect, vi, afterEach } from "vitest";
import { AnthropicProvider, ProviderError } from "../../../src/ai/provider";
import type { AnalysisInput } from "../../../src/ai/schemas";

const sampleInput: AnalysisInput = {
  command: ["npm", "test"],
  exitCode: 1,
  signal: null,
  stdout: "",
  stderr: "some failure",
  project: {
    packageManager: "npm",
    hasTypeScript: false,
    hasJest: false,
    hasVitest: false,
    hasDocker: false,
  },
  relevantFiles: [],
  deterministicFindings: [],
};

function mockFetchOnce(response: Partial<Response> & { json?: () => unknown; text?: () => unknown }) {
  const fetchMock = vi.fn().mockResolvedValue({
    ok: response.ok ?? true,
    status: response.status ?? 200,
    json: response.json ?? (async () => ({})),
    text: response.text ?? (async () => ""),
  } as Response);
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("AnthropicProvider", () => {
  it("parses a well-formed JSON response into a validated AnalysisResult", async () => {
    const modelJson = JSON.stringify({
      summary: "Test failed",
      rootCause: "Missing config",
      confidence: 0.7,
      evidence: ["evidence 1"],
      assumptions: [],
      actions: ["fix it"],
    });

    mockFetchOnce({
      json: async () => ({ content: [{ type: "text", text: modelJson }] }),
    });

    const provider = new AnthropicProvider({ apiKey: "test-key" });
    const result = await provider.analyze(sampleInput);

    expect(result.summary).toBe("Test failed");
    expect(result.confidence).toBe(0.7);
  });

  it("strips a markdown code fence if the model wraps its JSON", async () => {
    const modelJson =
      "```json\n" +
      JSON.stringify({ summary: "s", rootCause: "r", confidence: 0.5 }) +
      "\n```";

    mockFetchOnce({
      json: async () => ({ content: [{ type: "text", text: modelJson }] }),
    });

    const provider = new AnthropicProvider({ apiKey: "test-key" });
    const result = await provider.analyze(sampleInput);
    expect(result.summary).toBe("s");
  });

  it("throws ProviderError on a non-2xx HTTP response", async () => {
    mockFetchOnce({ ok: false, status: 401, text: async () => "unauthorized" });

    const provider = new AnthropicProvider({ apiKey: "bad-key" });
    await expect(provider.analyze(sampleInput)).rejects.toThrow(ProviderError);
  });

  it("throws ProviderError when the response isn't valid JSON", async () => {
    mockFetchOnce({
      json: async () => ({ content: [{ type: "text", text: "not json at all" }] }),
    });

    const provider = new AnthropicProvider({ apiKey: "test-key" });
    await expect(provider.analyze(sampleInput)).rejects.toThrow(ProviderError);
  });

  it("throws ProviderError when the JSON doesn't match the required schema", async () => {
    mockFetchOnce({
      json: async () => ({
        content: [{ type: "text", text: JSON.stringify({ summary: "only this" }) }],
      }),
    });

    const provider = new AnthropicProvider({ apiKey: "test-key" });
    await expect(provider.analyze(sampleInput)).rejects.toThrow(ProviderError);
  });

  it("sends the redacted input and system prompt in the request body", async () => {
    const fetchMock = mockFetchOnce({
      json: async () => ({
        content: [
          {
            type: "text",
            text: JSON.stringify({ summary: "s", rootCause: "r", confidence: 0.5 }),
          },
        ],
      }),
    });

    const provider = new AnthropicProvider({ apiKey: "test-key", model: "test-model" });
    await provider.analyze(sampleInput);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [, requestInit] = fetchMock.mock.calls[0];
    const body = JSON.parse(requestInit.body as string);
    expect(body.model).toBe("test-model");
    expect(body.system).toContain("You are the AI reasoning layer");
    expect(body.messages[0].content).toContain("npm");
  });
});
