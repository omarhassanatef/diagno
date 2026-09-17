#!/usr/bin/env node

import * as readline from "readline/promises";
import { NodeCommandRunner } from "../runner/commandRunner";
import { renderOutcome, renderFindings, renderAiResult } from "../render/terminalRenderer";
import { ProjectDetector } from "../detection/projectDetector";
import { ContextCollector } from "../context/contextCollector";
import { runAnalyzers } from "../analyzers/orchestrator";
import { runAiAnalysis } from "../ai/orchestrator";
import { AnthropicProvider } from "../ai/provider";
import { runConfigCommand } from "./configCommand";
import { resolveApiKey, resolveAiModel } from "../config/configStore";
import { isAutoApplicable, validateTarget, applyAndRerun } from "../fixes/fixEngine";
import { renderUnifiedDiff } from "../fixes/diff";
import type { Finding, PatchProposal } from "../types/finding";
import type { AnalyzerContext } from "../analyzers/types";
import type { AiOutcome } from "../ai/orchestrator";
import type { RunOutcome } from "../runner/types";

// eslint-disable-next-line @typescript-eslint/no-var-requires
const pkg = require("../../package.json") as { version: string };

/** Below this confidence (or with no findings at all), a deterministic
 * diagnosis is considered ambiguous enough to hand off to the AI reasoning
 * layer, per the blueprint's "AI augments ambiguous cases" rule. */
const AI_HANDOFF_CONFIDENCE_THRESHOLD = 0.7;

const HELP_TEXT = `sift - AI-assisted CLI for understanding failed developer commands

Usage:
  sift <command...>     Run a command and report on the result
  sift --help, -h       Show this help message
  sift --version, -v    Show the installed version
  sift --json <cmd...>  Print machine-readable JSON instead of formatted text
  sift --no-ai <cmd...> Skip AI-assisted analysis; deterministic checks only
  sift --fix <cmd...>   Offer to apply the top fix, show a diff, and rerun
  sift --fix --yes <cmd...>  Same, but auto-confirm instead of prompting
  sift config ...        Manage stored settings (e.g. your API key)

Examples:
  sift npm test
  sift npm run build
  sift pytest

When a command fails, SIFT first runs local deterministic analyzers
(dependency, TypeScript/Jest, env vars, ports, lockfiles, Docker). If none of
those produce a confident diagnosis and ANTHROPIC_API_KEY is set, SIFT asks
an AI reasoning layer to explain the failure -- clearly labeled and kept
separate from the deterministic, evidence-checked findings above it.

With --fix, if the top finding has a fix SIFT can apply automatically, it
shows a unified diff, asks for explicit confirmation, applies the change
atomically, and reruns your original command to check whether it actually
worked. SIFT never applies a fix without a diff and your explicit "y".

Environment variables:
  ANTHROPIC_API_KEY   Enables AI-assisted analysis when deterministic
                      diagnosis is inconclusive. Without it, SIFT still
                      works -- just without that fallback.
  SIFT_AI_MODEL       Overrides the default Anthropic model used.

Both of the above can also be stored locally instead, so you don't have to
export them in every shell:
  sift config set api-key <your-key>
  sift config set model <model-name>
Run 'sift config --help' for details. A value set via environment variable
always takes priority over a stored one.
`;

const SIFT_FLAGS = new Set(["--json", "--no-ai", "--fix", "--yes"]);

/** Splits argv into SIFT's own leading flags and the wrapped command.
 * Only flags SIFT recognizes are consumed from the front; anything else
 * (including flags) is treated as the start of the wrapped command, since
 * those belong to the tool being run, not to SIFT. */
function parseArgv(argv: string[]): {
  json: boolean;
  noAi: boolean;
  fix: boolean;
  yes: boolean;
  command: string[];
} {
  let json = false;
  let noAi = false;
  let fix = false;
  let yes = false;
  let i = 0;
  while (i < argv.length && SIFT_FLAGS.has(argv[i])) {
    if (argv[i] === "--json") json = true;
    if (argv[i] === "--no-ai") noAi = true;
    if (argv[i] === "--fix") fix = true;
    if (argv[i] === "--yes") yes = true;
    i++;
  }
  return { json, noAi, fix, yes, command: argv.slice(i) };
}

async function diagnose(
  cwd: string,
  failure: Awaited<ReturnType<NodeCommandRunner["run"]>>
): Promise<{ findings: Finding[]; context: AnalyzerContext }> {
  const detector = new ProjectDetector();
  const collector = new ContextCollector();
  const project = detector.detect(cwd);
  const collected = collector.collect(project);
  const context: AnalyzerContext = { failure, project, collected };
  const findings = await runAnalyzers(context);
  return { findings, context };
}

function isDiagnosisAmbiguous(findings: Finding[]): boolean {
  return findings.length === 0 || findings[0].confidence < AI_HANDOFF_CONFIDENCE_THRESHOLD;
}

async function maybeRunAi(
  context: AnalyzerContext,
  findings: Finding[],
  noAi: boolean
): Promise<AiOutcome | undefined> {
  if (noAi || !isDiagnosisAmbiguous(findings)) return undefined;

  const { value: apiKey } = resolveApiKey();
  if (!apiKey) {
    return {
      ok: false,
      error:
        "No Anthropic API key found (checked ANTHROPIC_API_KEY and 'sift config'); skipping AI-assisted analysis. Run `sift config set api-key <key>` to enable it.",
    };
  }

  const provider = new AnthropicProvider({
    apiKey,
    model: resolveAiModel(),
  });
  return runAiAnalysis(context, findings, provider);
}

/** Prompts on the real terminal for explicit y/N confirmation. Never
 * auto-confirms on a non-interactive stdin -- that's what --yes is for. */
async function promptConfirm(question: string): Promise<boolean> {
  if (!process.stdin.isTTY) return false;
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });
  try {
    const answer = await rl.question(question);
    return /^y(es)?$/i.test(answer.trim());
  } finally {
    rl.close();
  }
}

interface FixReport {
  applicable: boolean;
  reason?: string;
  patch?: PatchProposal;
  diff?: string;
  requiresConfirmation?: boolean;
  confirmed?: boolean;
  applied?: boolean;
  rerun?: RunOutcome;
  resolved?: boolean;
}

/**
 * Runs the full Fix Engine flow (blueprint section 7): find a machine-
 * applicable patch, validate the target is still fresh, show a diff, get
 * explicit confirmation, apply atomically, then rerun the original command
 * to check whether the failure is actually resolved.
 */
async function runFixFlow(
  findings: Finding[],
  runner: NodeCommandRunner,
  command: string[],
  cwd: string,
  json: boolean,
  autoYes: boolean
): Promise<FixReport> {
  const patch = findings[0]?.patch;

  if (!patch) {
    return { applicable: false, reason: "No finding with a proposed fix was available." };
  }

  if (!isAutoApplicable(patch)) {
    return {
      applicable: false,
      patch,
      reason: "SIFT can't confidently auto-apply this fix yet -- the suggested change requires human judgment.",
    };
  }

  const validation = validateTarget(patch);
  if (!validation.ok) {
    return { applicable: true, patch, reason: validation.reason };
  }

  const diff = renderUnifiedDiff(patch.filePath, patch.beforeContent, patch.newContent);

  if (!json) {
    // Always show the diff before applying anything -- even with --yes,
    // per the blueprint's "show a unified diff" step. --yes only skips the
    // interactive question that follows, never the transparency step.
    process.stdout.write("\n" + diff + "\n");
  }

  let confirmed = autoYes;
  if (!confirmed) {
    if (json) {
      // JSON output is meant to be parsed, not to block on an interactive
      // prompt -- require --yes explicitly in this mode instead.
      return { applicable: true, patch, diff, requiresConfirmation: true, confirmed: false };
    }
    confirmed = await promptConfirm("Apply this fix? [y/N] ");
  }

  if (!confirmed) {
    return { applicable: true, patch, diff, confirmed: false };
  }

  const fixOutcome = await applyAndRerun(patch, runner, command, cwd, { stream: !json });
  return {
    applicable: true,
    patch,
    diff,
    confirmed: true,
    applied: true,
    rerun: fixOutcome.rerun,
    resolved: fixOutcome.resolved,
  };
}

function renderFixReport(report: FixReport, json: boolean): string {
  if (json) return ""; // JSON mode carries the fix report in the JSON body instead.

  if (!report.applicable) {
    return `\n(${report.reason})\n`;
  }

  if (report.reason) {
    // Applicable in principle, but validation failed (stale file, etc.).
    return `\n(${report.reason})\n`;
  }

  if (report.confirmed === false) {
    return `\nFix not applied.\n`;
  }

  if (report.applied && report.rerun) {
    const lines = [
      "",
      `Applied fix to ${report.patch?.filePath}.`,
      `Re-running: ${report.rerun.command.join(" ")}`,
      renderOutcome(report.rerun),
      "",
      report.resolved
        ? "\u2713 Fixed! The original failure no longer reproduces."
        : "\u2717 Applied the fix, but the command still fails. See the output above.",
    ];
    return lines.join("\n") + "\n";
  }

  return "";
}

async function main(): Promise<void> {
  const rawArgv = process.argv.slice(2);

  if (rawArgv[0] === "config") {
    const code = await runConfigCommand(rawArgv.slice(1));
    process.exit(code);
    return;
  }

  if (rawArgv.length === 0 || rawArgv[0] === "--help" || rawArgv[0] === "-h") {
    process.stdout.write(HELP_TEXT);
    process.exit(rawArgv.length === 0 ? 1 : 0);
  }

  if (rawArgv[0] === "--version" || rawArgv[0] === "-v") {
    process.stdout.write(`${pkg.version}\n`);
    process.exit(0);
  }

  const { json, noAi, fix, yes, command } = parseArgv(rawArgv);

  if (command.length === 0) {
    process.stdout.write(HELP_TEXT);
    process.exit(1);
  }

  const runner = new NodeCommandRunner();
  const outcome = await runner.run(command, { stream: !json });

  let findings: Finding[] = [];
  let aiOutcome: AiOutcome | undefined;
  let fixReport: FixReport | undefined;
  const isRealFailure = !outcome.success && !outcome.errorType;

  if (isRealFailure) {
    const diagnosis = await diagnose(outcome.cwd, outcome);
    findings = diagnosis.findings;
    aiOutcome = await maybeRunAi(diagnosis.context, findings, noAi);

    if (fix) {
      fixReport = await runFixFlow(findings, runner, command, outcome.cwd, json, yes);
    }
  }

  if (json) {
    process.stdout.write(
      JSON.stringify({ outcome, findings, ai: aiOutcome, fix: fixReport }, null, 2) + "\n"
    );
  } else {
    process.stdout.write("\n");
    process.stdout.write(renderOutcome(outcome) + "\n");
    if (isRealFailure) {
      process.stdout.write("\n" + renderFindings(findings) + "\n");
      if (aiOutcome?.ok) {
        process.stdout.write(
          "\n" + renderAiResult(aiOutcome.result, aiOutcome.providerId) + "\n"
        );
      } else if (aiOutcome && !aiOutcome.ok && isDiagnosisAmbiguous(findings)) {
        process.stdout.write(`\n(${aiOutcome.error})\n`);
      }
      if (fixReport) {
        process.stdout.write(renderFixReport(fixReport, json));
      }
    }
  }

  if (outcome.errorType) {
    process.exit(127);
    return;
  }

  // If a fix was actually applied and rerun, the rerun's result is the
  // final word on whether this failure is resolved -- report that exit
  // code instead of the original failure's.
  if (fixReport?.applied && fixReport.rerun) {
    process.exit(fixReport.rerun.exitCode ?? (fixReport.resolved ? 0 : 1));
    return;
  }

  process.exit(outcome.exitCode ?? (outcome.success ? 0 : 1));
}

main().catch((err: unknown) => {
  // Defensive fallback only: NodeCommandRunner is designed never to throw.
  // If something still goes wrong here, fail cleanly rather than dumping a
  // raw stack trace.
  const message = err instanceof Error ? err.message : String(err);
  process.stderr.write(`sift: unexpected internal error: ${message}\n`);
  process.exit(1);
});
