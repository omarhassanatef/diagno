/**
 * A single piece of evidence supporting or contradicting a finding.
 * Rendered as a checklist (✓/✗) in the terminal, mirroring the blueprint's
 * example UX. Evidence should be a concrete, checkable fact -- not a guess.
 */
export interface Evidence {
  /** Human-readable description, e.g. "tsconfig.json defines @/* → src/*". */
  description: string;
  /** Where this evidence came from, e.g. "tsconfig.json", "stderr". */
  source: string;
  /** Whether this piece of evidence supports (true) or undermines (false) the finding. */
  passed: boolean;
}

/** A concrete, human-actionable next step. Distinct from an automatic fix. */
export interface Action {
  description: string;
}

/**
 * A proposed change to a specific file. `snippet` is always present for
 * human display. `beforeContent`/`newContent` are populated only when an
 * analyzer can confidently compute the *entire* resulting file text --
 * that's what makes a patch machine-applicable by the Fix Engine (Phase 3).
 * Most analyzers only produce a snippet (a suggestion to apply by hand);
 * that's expected and fine.
 */
export interface PatchProposal {
  filePath: string;
  description: string;
  snippet: string;
  /** The file's exact content at diagnosis time, used to detect a stale
   * patch before applying. Omit if the file doesn't exist yet (creation). */
  beforeContent?: string;
  /** The complete new file content. Only set when the analyzer can compute
   * the whole file confidently; omitted means "not auto-applicable". */
  newContent?: string;
}

export type Severity = "info" | "warning" | "error";

/**
 * The structured output of a single analyzer's diagnosis. Confidence is a
 * 0..1 estimate of how likely this finding explains the actual failure --
 * analyzers should be conservative and evidence-driven, never guess wildly.
 */
export interface Finding {
  id: string;
  analyzerId: string;
  title: string;
  severity: Severity;
  confidence: number;
  evidence: Evidence[];
  explanation: string;
  suggestedActions: Action[];
  patch?: PatchProposal;
}
