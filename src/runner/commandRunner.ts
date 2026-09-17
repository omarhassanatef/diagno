import { spawn } from "child_process";
import type {
  CommandRunner,
  RunOptions,
  RunOutcome,
} from "./types";

/**
 * NodeCommandRunner executes a command using Node's built-in child_process,
 * streaming stdout/stderr live to the terminal while also capturing them in
 * full for later analysis.
 *
 * Design notes:
 * - `shell` is only enabled on Windows, where many common developer tools
 *   (npm, npx, yarn, etc.) are `.cmd` shims that the OS can only resolve via
 *   a shell. On POSIX platforms we spawn directly so signal handling and
 *   exit codes are unambiguous.
 * - We never swallow the child's own failure into a Node.js stack trace.
 *   Spawn failures (e.g. command not found) are captured as structured
 *   errors on the outcome instead of being thrown.
 */
export class NodeCommandRunner implements CommandRunner {
  run(command: string[], options: RunOptions = {}): Promise<RunOutcome> {
    const cwd = options.cwd ?? process.cwd();
    const stream = options.stream ?? true;

    if (command.length === 0) {
      return Promise.resolve({
        command,
        cwd,
        exitCode: null,
        signal: null,
        stdout: "",
        stderr: "",
        durationMs: 0,
        success: false,
        errorType: "spawn-error",
        errorMessage: "No command was provided to run.",
      });
    }

    const [executable, ...args] = command;
    const useShell = process.platform === "win32";
    const start = process.hrtime.bigint();

    return new Promise<RunOutcome>((resolve) => {
      let stdout = "";
      let stderr = "";
      let settled = false;

      const child = spawn(executable, args, {
        cwd,
        shell: useShell,
        stdio: ["inherit", "pipe", "pipe"],
      });

      const elapsedMs = (): number =>
        Number((process.hrtime.bigint() - start) / BigInt(1_000_000));

      const settle = (outcome: RunOutcome) => {
        if (settled) return;
        settled = true;
        resolve(outcome);
      };

      child.stdout?.on("data", (chunk: Buffer) => {
        const text = chunk.toString();
        stdout += text;
        if (stream) process.stdout.write(text);
      });

      child.stderr?.on("data", (chunk: Buffer) => {
        const text = chunk.toString();
        stderr += text;
        if (stream) process.stderr.write(text);
      });

      child.on("error", (err: NodeJS.ErrnoException) => {
        const notFound = err.code === "ENOENT";
        settle({
          command,
          cwd,
          exitCode: null,
          signal: null,
          stdout,
          stderr,
          durationMs: elapsedMs(),
          success: false,
          errorType: notFound ? "not-found" : "spawn-error",
          errorMessage: notFound
            ? `Command not found: ${executable}`
            : err.message,
        });
      });

      child.on("close", (code, signal) => {
        settle({
          command,
          cwd,
          exitCode: code,
          signal: signal as NodeJS.Signals | null,
          stdout,
          stderr,
          durationMs: elapsedMs(),
          success: code === 0 && signal === null,
        });
      });
    });
  }
}
