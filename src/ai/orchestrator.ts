import * as path from "path";
import { redactSecrets } from "./redaction";
import { AnalysisInputSchema } from "./schemas";
import type { AnalysisInput, AnalysisResult } from "./schemas";
import type { LLMProvider } from "./provider";
import type { AnalyzerContext } from "../analyzers/types";
import type { Finding } from "../types/finding";

/** Caps on any single blob of text handed to the model. Errors are almost
 * always most informative near the end of output, so we keep the tail. */
const MAX_OUTPUT_CHARS = 4000;
const MAX_FILE_CHARS = 4000;

function boundTail(text: string, max: number): string {
  if (text.length <= max) return text;
  return `...[truncated ${text.length - max} earlier characters]...\n${text.slice(-max)}`;
}

function redactedTail(text: string, max: number): string {
  return redactSecrets(boundTail(text, max)).text;
}

/**
 * Builds the exact, minimal, redacted payload that will be sent to an AI
 * provider. This is the single choke point for what data leaves the
 * machine -- every field here has already passed through ContextCollector's
 * collection rules and this function's own bounding + redaction.
 */
export function buildAnalysisInput(
  context: AnalyzerContext,
  deterministicFindings: Finding[]
): AnalysisInput {
  const { failure, project, collected } = context;

  const relevantFiles: AnalysisInput["relevantFiles"] = [];

  if (collected.tsconfigContent && project.tsconfigPath) {
    relevantFiles.push({
      path: path.relative(project.root, project.tsconfigPath),
      content: redactedTail(collected.tsconfigContent, MAX_FILE_CHARS),
    });
  }

  if (collected.jestConfigContent && project.jestConfigPath) {
    relevantFiles.push({
      path: path.relative(project.root, project.jestConfigPath),
      content: redactedTail(collected.jestConfigContent, MAX_FILE_CHARS),
    });
  }

  for (const dockerFile of collected.dockerFiles) {
    relevantFiles.push({
      path: path.relative(project.root, dockerFile.path),
      content: redactedTail(dockerFile.content, MAX_FILE_CHARS),
    });
  }

  return {
    command: failure.command,
    exitCode: failure.exitCode,
    signal: failure.signal,
    stdout: redactedTail(failure.stdout, MAX_OUTPUT_CHARS),
    stderr: redactedTail(failure.stderr, MAX_OUTPUT_CHARS),
    project: {
      packageManager: project.packageManager,
      hasTypeScript: project.hasTypeScript,
      hasJest: project.hasJest,
      hasVitest: project.hasVitest,
      hasDocker: project.hasDocker,
    },
    relevantFiles,
    deterministicFindings: deterministicFindings.map((f) => ({
      title: f.title,
      confidence: f.confidence,
      explanation: f.explanation,
    })),
  };
}

export type AiOutcome =
  | { ok: true; result: AnalysisResult; providerId: string }
  | { ok: false; error: string };

/**
 * Runs the AI reasoning layer. Never throws -- a provider failure (network
 * error, invalid response, bad schema) degrades to `{ ok: false }` so the
 * CLI can fall back to "deterministic diagnosis only" rather than crashing.
 * This is what "remain useful without AI" means in practice.
 */
export async function runAiAnalysis(
  context: AnalyzerContext,
  deterministicFindings: Finding[],
  provider: LLMProvider
): Promise<AiOutcome> {
  const rawInput = buildAnalysisInput(context, deterministicFindings);

  // Defensive self-check: if our own input doesn't match the schema we
  // promise providers, something upstream is wrong -- fail closed rather
  // than sending a malformed or unexpectedly-shaped payload.
  const parsedInput = AnalysisInputSchema.safeParse(rawInput);
  if (!parsedInput.success) {
    return {
      ok: false,
      error: `Internal error building AI input: ${parsedInput.error.message}`,
    };
  }

  try {
    const result = await provider.analyze(parsedInput.data);
    return { ok: true, result, providerId: provider.id };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}
