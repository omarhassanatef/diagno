import type { Analyzer, AnalyzerContext } from "./types";
import type { Finding } from "../types/finding";

import { missingDependencyAnalyzer } from "./node/missingDependency";
import { nodeVersionMismatchAnalyzer } from "./node/nodeVersionMismatch";
import { lockfileMismatchAnalyzer } from "./node/lockfileMismatch";
import { missingEnvVarAnalyzer } from "./common/missingEnvVar";
import { portInUseAnalyzer } from "./common/portInUse";
import { tsConfigConflictAnalyzer } from "./typescript/tsConfigConflict";
import { pathAliasMismatchAnalyzer } from "./jest/pathAliasMismatch";
import { dockerIssuesAnalyzer } from "./docker/dockerIssues";

/**
 * The MVP deterministic analyzer set (blueprint section 9). Order here only
 * matters as a tie-breaker for display when confidences are equal --
 * findings are otherwise sorted by confidence before rendering.
 */
export const DEFAULT_ANALYZERS: Analyzer[] = [
  pathAliasMismatchAnalyzer,
  missingDependencyAnalyzer,
  nodeVersionMismatchAnalyzer,
  lockfileMismatchAnalyzer,
  missingEnvVarAnalyzer,
  portInUseAnalyzer,
  tsConfigConflictAnalyzer,
  dockerIssuesAnalyzer,
];

/**
 * Runs every applicable analyzer against a failure and returns all findings,
 * sorted with the most confident diagnosis first. Analyzers are independent
 * and read-only; one analyzer's failure to produce a finding never blocks
 * another's.
 */
export async function runAnalyzers(
  context: AnalyzerContext,
  analyzers: Analyzer[] = DEFAULT_ANALYZERS
): Promise<Finding[]> {
  const applicable = analyzers.filter((a) => {
    try {
      return a.canAnalyze(context);
    } catch {
      // A misbehaving canAnalyze() should never crash the whole run.
      return false;
    }
  });

  const results = await Promise.all(
    applicable.map(async (a) => {
      try {
        return await a.analyze(context);
      } catch {
        // Same defensive posture for analyze(): one bad analyzer degrades
        // gracefully rather than taking down the diagnostic pass.
        return [];
      }
    })
  );

  return results.flat().sort((a, b) => b.confidence - a.confidence);
}
