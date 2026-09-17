/**
 * FailureContext is the core captured record of a single command execution.
 * This is a Phase 0 subset of the full blueprint model: it only includes
 * fields the command runner itself is responsible for producing. Project
 * detection, git context, and AI-related fields are added in later phases.
 */
export interface FailureContext {
  command: string[];
  cwd: string;
  exitCode: number | null;
  signal: NodeJS.Signals | null;
  stdout: string;
  stderr: string;
  durationMs: number;
}

/**
 * Why a run did not produce a normal exit code, when applicable.
 * - "not-found": the executable itself could not be located (ENOENT).
 * - "spawn-error": some other error occurred trying to start the process.
 */
export type RunErrorType = "not-found" | "spawn-error";

/**
 * The full result of running a command through DIAGNO's runner.
 * `success` is true only when the process exited with code 0 and was not
 * killed by a signal.
 */
export interface RunOutcome extends FailureContext {
  success: boolean;
  errorType?: RunErrorType;
  errorMessage?: string;
}

export interface RunOptions {
  /** Working directory to run the command in. Defaults to process.cwd(). */
  cwd?: string;
  /**
   * Whether to stream the child process's stdout/stderr to this process's
   * stdout/stderr while also capturing it. Defaults to true. Tests set this
   * to false to keep test output clean.
   */
  stream?: boolean;
}

/**
 * CommandRunner is the reusable interface behind command execution.
 * Kept small and provider-agnostic so alternative implementations
 * (e.g. sandboxed, remote, or mocked runners) can be swapped in later.
 */
export interface CommandRunner {
  run(command: string[], options?: RunOptions): Promise<RunOutcome>;
}
