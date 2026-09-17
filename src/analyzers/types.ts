import type { FailureContext } from "../runner/types";
import type { ProjectContext } from "../types/project";
import type { CollectedContext } from "../context/types";
import type { Finding } from "../types/finding";

/**
 * Everything a deterministic analyzer needs to inspect: the raw command
 * failure, what kind of project this is, and the bounded set of relevant
 * files already read off disk. Analyzers should not do their own disk I/O
 * beyond narrow, well-justified checks (e.g. "does node_modules/X exist") --
 * broad collection belongs in ContextCollector so it stays auditable.
 */
export interface AnalyzerContext {
  failure: FailureContext;
  project: ProjectContext;
  collected: CollectedContext;
}

/**
 * Analyzer is the extension point for deterministic diagnostics. Each
 * analyzer owns one narrow failure pattern, decides quickly whether it's
 * relevant via canAnalyze, and only then does the (still fully local, still
 * fully deterministic) work of building evidence-backed Findings.
 */
export interface Analyzer {
  id: string;
  canAnalyze(context: AnalyzerContext): boolean;
  analyze(context: AnalyzerContext): Promise<Finding[]>;
}
