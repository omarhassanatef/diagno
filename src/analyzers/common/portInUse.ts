import { execFileSync } from "child_process";
import type { Analyzer, AnalyzerContext } from "../types";
import type { Finding } from "../../types/finding";

const EADDRINUSE = /EADDRINUSE/;
/** Pulls a port number out of common phrasings, e.g.
 * "listen EADDRINUSE: address already in use :::3000"
 * "Error: bind: address already in use 0.0.0.0:8080" */
const PORT_PATTERN = /(?:[:.]|port\s+)(\d{2,5})\b/i;

/** Best-effort, read-only lookup of what's holding a port. Never used to
 * kill or modify anything -- just extra evidence for the finding. Silently
 * returns undefined on any failure (missing tool, permissions, Windows). */
function tryFindProcessOnPort(port: string): string | undefined {
  if (process.platform === "win32") return undefined;
  try {
    const out = execFileSync("lsof", ["-i", `:${port}`], {
      encoding: "utf8",
      timeout: 2000,
    }).trim();
    if (!out) return undefined;
    // lsof prints a header line plus one line per matching process.
    const lines = out.split("\n").slice(1);
    return lines.length > 0 ? lines[0] : undefined;
  } catch {
    return undefined;
  }
}

export const portInUseAnalyzer: Analyzer = {
  id: "port-in-use",

  canAnalyze(context: AnalyzerContext): boolean {
    return EADDRINUSE.test(context.failure.stderr + context.failure.stdout);
  },

  async analyze(context: AnalyzerContext): Promise<Finding[]> {
    const output = context.failure.stderr + context.failure.stdout;
    if (!EADDRINUSE.test(output)) return [];

    const portMatch = output.match(PORT_PATTERN);
    const port = portMatch?.[1];
    const occupant = port ? tryFindProcessOnPort(port) : undefined;

    const evidence: Finding["evidence"] = [
      {
        description: "output reports EADDRINUSE (address already in use)",
        source: "stderr/stdout",
        passed: true,
      },
    ];

    if (port) {
      evidence.push({
        description: `the affected port appears to be ${port}`,
        source: "stderr/stdout",
        passed: true,
      });
    }

    if (occupant) {
      evidence.push({
        description: `a process is currently listening on that port: ${occupant}`,
        source: "lsof",
        passed: true,
      });
    }

    return [
      {
        id: "port-already-in-use",
        analyzerId: this.id,
        title: port
          ? `Port ${port} is already in use`
          : "A port is already in use",
        severity: "error",
        confidence: port ? 0.85 : 0.6,
        explanation: `The command failed to bind because another process is already listening on ${
          port ? `port ${port}` : "the target port"
        }. This is usually a leftover dev server from a previous run, or a genuinely different service using that port.`,
        evidence,
        suggestedActions: port
          ? [
              {
                description: `Find and stop the process using the port: \`lsof -i :${port}\` then \`kill <PID>\` (macOS/Linux), or \`netstat -ano | findstr :${port}\` (Windows).`,
              },
              { description: `Or configure the app to use a different port.` },
            ]
          : [
              { description: "Identify the process holding the port and stop it, or use a different port." },
            ],
      },
    ];
  },
};
