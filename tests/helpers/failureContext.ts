import type { FailureContext } from "../../src/runner/types";

export function makeFailure(overrides: Partial<FailureContext> = {}): FailureContext {
  return {
    command: ["some-command"],
    cwd: process.cwd(),
    exitCode: 1,
    signal: null,
    stdout: "",
    stderr: "",
    durationMs: 10,
    ...overrides,
  };
}
