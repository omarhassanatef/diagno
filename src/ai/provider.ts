import type { AnalysisInput, AnalysisResult } from "./schemas";
import { AnalysisResultSchema } from "./schemas";
import { SYSTEM_PROMPT, buildUserMessage } from "./prompts";

/**
 * LLMProvider is the extension point for AI reasoning. DIAGNO's orchestrator
 * only ever talks to this interface, never to a specific vendor's SDK
 * directly -- so hosted APIs, local models, or an organization's own
 * provider can be swapped in without touching the orchestrator.
 */
export interface LLMProvider {
  /** A short identifier for logs/errors, e.g. "anthropic:claude-3-5-sonnet". */
  readonly id: string;
  analyze(input: AnalysisInput): Promise<AnalysisResult>;
}

export class ProviderError extends Error {
  constructor(
    message: string,
    readonly cause?: unknown,
  ) {
    super(message);
    this.name = "ProviderError";
  }
}

/** Strips a leading/trailing markdown code fence, in case a model wraps its
 * JSON in ```json ... ``` despite being asked not to. */
function stripCodeFence(text: string): string {
  const fenced = text.trim().match(/^```(?:json)?\s*([\s\S]*?)\s*```$/);
  return fenced ? fenced[1] : text;
}

export interface AnthropicProviderOptions {
  apiKey: string;
  model?: string;
  /** Overridable for tests; defaults to the real Anthropic API. */
  endpoint?: string;
  maxTokens?: number;
}

/**
 * Calls the Anthropic Messages API directly over HTTPS. Requires an API key
 * (never hardcoded -- read from the environment by whoever constructs this).
 * The model name is configurable via DIAGNO_AI_MODEL since model availability
 * changes over time; check Anthropic's docs for current model names.
 */
export class AnthropicProvider implements LLMProvider {
  readonly id: string;
  private readonly apiKey: string;
  private readonly model: string;
  private readonly endpoint: string;
  private readonly maxTokens: number;

  constructor(options: AnthropicProviderOptions) {
    this.apiKey = options.apiKey;
    this.model = options.model ?? "claude-3-5-sonnet-latest";
    this.endpoint = options.endpoint ?? "https://api.anthropic.com/v1/messages";
    this.maxTokens = options.maxTokens ?? 1024;
    this.id = `anthropic:${this.model}`;
  }

  async analyze(input: AnalysisInput): Promise<AnalysisResult> {
    let response: Response;
    try {
      response = await fetch(this.endpoint, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-api-key": this.apiKey,
          "anthropic-version": "2023-06-01",
        },
        body: JSON.stringify({
          model: this.model,
          max_tokens: this.maxTokens,
          system: SYSTEM_PROMPT,
          messages: [{ role: "user", content: buildUserMessage(input) }],
        }),
      });
    } catch (err) {
      throw new ProviderError(
        `Failed to reach the AI provider (${this.id}): ${
          err instanceof Error ? err.message : String(err)
        }`,
        err,
      );
    }

    if (!response.ok) {
      const body = await response.text().catch(() => "");
      throw new ProviderError(
        `AI provider (${this.id}) returned HTTP ${response.status}: ${body.slice(0, 500)}`,
      );
    }

    const data = (await response.json()) as {
      content?: Array<{ type: string; text?: string }>;
    };

    const textBlock = data.content?.find((b) => b.type === "text")?.text;
    if (!textBlock) {
      throw new ProviderError(
        `AI provider (${this.id}) returned no text content.`,
      );
    }

    let parsedJson: unknown;
    try {
      parsedJson = JSON.parse(stripCodeFence(textBlock));
    } catch (err) {
      throw new ProviderError(
        `AI provider (${this.id}) did not return valid JSON.`,
        err,
      );
    }

    const result = AnalysisResultSchema.safeParse(parsedJson);
    if (!result.success) {
      throw new ProviderError(
        `AI provider (${this.id}) response did not match the required schema: ${result.error.message}`,
      );
    }

    return result.data;
  }
}
