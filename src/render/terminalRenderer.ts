import type { RunOutcome } from "../runner/types";
import type { Finding } from "../types/finding";
import type { AnalysisResult } from "../ai/schemas";

const SYMBOL_OK = "\u2713"; // ✓
const SYMBOL_FAIL = "\u2717"; // ✗

function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}

/**
 * Renders a one-line summary of a command's outcome. Phase 0 intentionally
 * keeps this minimal: the child process's own stdout/stderr has already been
 * streamed live, so this line just tells the developer, at a glance, what
 * SIFT itself observed. Deterministic analyzers and AI explanations are
 * added in later phases.
 */
export function renderOutcome(outcome: RunOutcome): string {
  const commandLabel = outcome.command.join(" ");
  const duration = formatDuration(outcome.durationMs);

  if (outcome.errorType === "not-found") {
    return `${SYMBOL_FAIL} ${commandLabel}\n  ${outcome.errorMessage}`;
  }

  if (outcome.errorType === "spawn-error") {
    return `${SYMBOL_FAIL} ${commandLabel}\n  Failed to run command: ${outcome.errorMessage}`;
  }

  if (outcome.success) {
    return `${SYMBOL_OK} ${commandLabel} (${duration})`;
  }

  if (outcome.signal) {
    return `${SYMBOL_FAIL} ${commandLabel} (killed by ${outcome.signal}, ${duration})`;
  }

  return `${SYMBOL_FAIL} ${commandLabel} (exit code ${outcome.exitCode}, ${duration})`;
}

/**
 * Renders one finding in the blueprint's demo format:
 *   WHY IT FAILED / EVIDENCE (✓/✗ checklist) / LIKELY FIX / Confidence: NN%
 * This is the deterministic-analyzer format; see renderAiResult() below for
 * the visually distinct AI-explanation format.
 */
export function renderFinding(finding: Finding): string {
  const lines: string[] = [];

  lines.push("WHY IT FAILED");
  lines.push(finding.explanation);
  lines.push("");

  lines.push("EVIDENCE");
  for (const item of finding.evidence) {
    const mark = item.passed ? SYMBOL_OK : SYMBOL_FAIL;
    lines.push(` ${mark} ${item.description}`);
  }
  lines.push("");

  lines.push("LIKELY FIX");
  if (finding.patch) {
    lines.push(finding.patch.description + ":");
    lines.push(
      finding.patch.snippet
        .split("\n")
        .map((l) => " " + l)
        .join("\n")
    );
  }
  for (const action of finding.suggestedActions) {
    lines.push(`- ${action.description}`);
  }
  lines.push("");

  lines.push(`Confidence: ${Math.round(finding.confidence * 100)}%`);

  return lines.join("\n");
}

/**
 * Renders the full diagnostic section shown after a failed command: the top
 * (most confident) finding in full, followed by a short mention of any
 * additional findings so the developer knows more context is available.
 * Falls back to an honest "nothing found" message rather than fabricating
 * a diagnosis -- SIFT should remain useful (and trustworthy) without AI.
 */
export function renderFindings(findings: Finding[]): string {
  if (findings.length === 0) {
    return "No deterministic diagnosis found for this failure.\nRe-run with --verbose to inspect the raw output, or check back once AI-assisted analysis is available.";
  }

  const [top, ...rest] = findings;
  const sections = [renderFinding(top)];

  if (rest.length > 0) {
    const others = rest.map((f) => `- ${f.title} (${Math.round(f.confidence * 100)}%)`);
    sections.push(`Also detected:\n${others.join("\n")}`);
  }

  return sections.join("\n\n");
}

/**
 * Renders an AI-derived AnalysisResult. Visually and structurally distinct
 * from renderFinding(): facts ("evidence") and hypotheses ("assumptions")
 * are shown in separate sections, and the whole block is labeled as AI
 * reasoning rather than a verified deterministic diagnosis -- per the
 * blueprint's rule to always distinguish facts from hypotheses and to
 * treat AI as a reasoning layer, not the source of truth.
 */
export function renderAiResult(result: AnalysisResult, providerId: string): string {
  const lines: string[] = [];

  lines.push(`AI-ASSISTED EXPLANATION (via ${providerId}, unverified)`);
  lines.push(result.summary);
  lines.push("");
  lines.push(`Likely root cause: ${result.rootCause}`);

  if (result.evidence.length > 0) {
    lines.push("");
    lines.push("Evidence:");
    for (const e of result.evidence) lines.push(` - ${e}`);
  }

  if (result.assumptions.length > 0) {
    lines.push("");
    lines.push("Assumptions (not directly confirmed):");
    for (const a of result.assumptions) lines.push(` - ${a}`);
  }

  if (result.actions.length > 0) {
    lines.push("");
    lines.push("Suggested actions:");
    for (const a of result.actions) lines.push(` - ${a}`);
  }

  if (result.patchProposal) {
    lines.push("");
    lines.push(`Possible fix (${result.patchProposal.filePath}): ${result.patchProposal.description}`);
    lines.push(
      result.patchProposal.snippet
        .split("\n")
        .map((l) => " " + l)
        .join("\n")
    );
  }

  lines.push("");
  lines.push(`Confidence: ${Math.round(result.confidence * 100)}% (AI estimate, not verified by execution)`);

  return lines.join("\n");
}
