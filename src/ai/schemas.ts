import { z } from "zod";

/**
 * AnalysisInput is the *only* thing an LLMProvider ever sees. It is built
 * from already-redacted, already-bounded context -- never the raw
 * FailureContext/CollectedContext directly. Keeping this a narrow, explicit
 * shape (rather than "just pass everything") is what makes the privacy
 * boundary auditable.
 */
export const AnalysisInputSchema = z.object({
  command: z.array(z.string()),
  exitCode: z.number().nullable(),
  signal: z.string().nullable(),
  stdout: z.string(),
  stderr: z.string(),
  project: z.object({
    packageManager: z.string(),
    hasTypeScript: z.boolean(),
    hasJest: z.boolean(),
    hasVitest: z.boolean(),
    hasDocker: z.boolean(),
  }),
  relevantFiles: z.array(
    z.object({
      path: z.string(),
      content: z.string(),
    })
  ),
  /** Findings the deterministic analyzers already produced (as facts the
   * model should build on, not re-derive from scratch), even if none were
   * confident enough to show the user on their own. */
  deterministicFindings: z.array(
    z.object({
      title: z.string(),
      confidence: z.number(),
      explanation: z.string(),
    })
  ),
});

export type AnalysisInput = z.infer<typeof AnalysisInputSchema>;

/**
 * AnalysisResult is the strict structured shape every provider must return
 * (blueprint section 6). Anything that doesn't parse against this schema is
 * treated as a failed analysis, never shown to the user as a diagnosis.
 */
export const AnalysisResultSchema = z.object({
  summary: z.string().min(1),
  rootCause: z.string().min(1),
  confidence: z.number().min(0).max(1),
  evidence: z.array(z.string()).default([]),
  assumptions: z.array(z.string()).default([]),
  actions: z.array(z.string()).default([]),
  patchProposal: z
    .object({
      filePath: z.string(),
      description: z.string(),
      snippet: z.string(),
    })
    .optional(),
});

export type AnalysisResult = z.infer<typeof AnalysisResultSchema>;
