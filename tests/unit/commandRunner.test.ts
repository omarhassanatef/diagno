import { describe, it, expect } from "vitest";
import { NodeCommandRunner } from "../../src/runner/commandRunner";

const runner = new NodeCommandRunner();

// All test commands invoke `node -e "..."` so behavior is identical across
// platforms (Windows, macOS, Linux) and doesn't depend on shell built-ins.

describe("NodeCommandRunner", () => {
  it("captures a successful command", async () => {
    const outcome = await runner.run(
      [process.execPath, "-e", "process.exit(0)"],
      { stream: false }
    );

    expect(outcome.success).toBe(true);
    expect(outcome.exitCode).toBe(0);
    expect(outcome.signal).toBeNull();
    expect(outcome.errorType).toBeUndefined();
    expect(outcome.durationMs).toBeGreaterThanOrEqual(0);
  });

  it("captures a failing command's non-zero exit code", async () => {
    const outcome = await runner.run(
      [process.execPath, "-e", "process.exit(3)"],
      { stream: false }
    );

    expect(outcome.success).toBe(false);
    expect(outcome.exitCode).toBe(3);
    expect(outcome.signal).toBeNull();
  });

  it("captures stdout and stderr separately", async () => {
    const script =
      "console.log('hello-stdout'); console.error('hello-stderr');";
    const outcome = await runner.run([process.execPath, "-e", script], {
      stream: false,
    });

    expect(outcome.stdout).toContain("hello-stdout");
    expect(outcome.stderr).toContain("hello-stderr");
    expect(outcome.stdout).not.toContain("hello-stderr");
  });

  it("reports command-not-found as a structured error, not a throw", async () => {
    const outcome = await runner.run(
      ["this-command-does-not-exist-xyz-123"],
      { stream: false }
    );

    expect(outcome.success).toBe(false);
    expect(outcome.errorType).toBe("not-found");
    expect(outcome.exitCode).toBeNull();
    expect(outcome.errorMessage).toContain("this-command-does-not-exist-xyz-123");
  });

  it("records cwd and command as given", async () => {
    const outcome = await runner.run(
      [process.execPath, "-e", "process.exit(0)"],
      { cwd: process.cwd(), stream: false }
    );

    expect(outcome.cwd).toBe(process.cwd());
    expect(outcome.command).toEqual([process.execPath, "-e", "process.exit(0)"]);
  });

  it("resolves gracefully when given an empty command", async () => {
    const outcome = await runner.run([], { stream: false });

    expect(outcome.success).toBe(false);
    expect(outcome.errorType).toBe("spawn-error");
  });
});
