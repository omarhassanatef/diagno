import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import {
  isAutoApplicable,
  validateTarget,
  applyPatchAtomically,
  applyAndRerun,
} from "../../../src/fixes/fixEngine";
import { NodeCommandRunner } from "../../../src/runner/commandRunner";
import type { PatchProposal } from "../../../src/types/finding";

let tmpDir: string;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "sift-fixengine-"));
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe("isAutoApplicable", () => {
  it("is false when there's no patch", () => {
    expect(isAutoApplicable(undefined)).toBe(false);
  });

  it("is false when newContent wasn't computed", () => {
    expect(
      isAutoApplicable({ filePath: "x", description: "d", snippet: "s" })
    ).toBe(false);
  });

  it("is true when newContent is present", () => {
    expect(
      isAutoApplicable({
        filePath: "x",
        description: "d",
        snippet: "s",
        newContent: "new file content",
      })
    ).toBe(true);
  });
});

describe("validateTarget", () => {
  it("passes when the file matches beforeContent exactly", () => {
    const filePath = path.join(tmpDir, "jest.config.js");
    fs.writeFileSync(filePath, "module.exports = {};\n");

    const result = validateTarget({
      filePath,
      description: "d",
      snippet: "s",
      beforeContent: "module.exports = {};\n",
      newContent: "module.exports = { moduleNameMapper: {} };\n",
    });

    expect(result.ok).toBe(true);
  });

  it("fails when the file has changed since the patch was proposed (stale patch)", () => {
    const filePath = path.join(tmpDir, "jest.config.js");
    fs.writeFileSync(filePath, "module.exports = { changed: true };\n");

    const result = validateTarget({
      filePath,
      description: "d",
      snippet: "s",
      beforeContent: "module.exports = {};\n",
      newContent: "module.exports = { moduleNameMapper: {} };\n",
    });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toContain("changed since");
  });

  it("fails when the file no longer exists but beforeContent was expected", () => {
    const filePath = path.join(tmpDir, "does-not-exist.js");

    const result = validateTarget({
      filePath,
      description: "d",
      snippet: "s",
      beforeContent: "module.exports = {};\n",
      newContent: "module.exports = { moduleNameMapper: {} };\n",
    });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toContain("no longer exists");
  });

  it("passes when creating a brand-new file that doesn't exist yet", () => {
    const filePath = path.join(tmpDir, "new-jest.config.js");

    const result = validateTarget({
      filePath,
      description: "d",
      snippet: "s",
      newContent: "module.exports = {};\n",
      // beforeContent intentionally omitted -- signals "create".
    });

    expect(result.ok).toBe(true);
  });

  it("fails when a file to be created already exists (refuses to overwrite)", () => {
    const filePath = path.join(tmpDir, "already-there.js");
    fs.writeFileSync(filePath, "something unrelated");

    const result = validateTarget({
      filePath,
      description: "d",
      snippet: "s",
      newContent: "module.exports = {};\n",
    });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toContain("already exists");
  });
});

describe("applyPatchAtomically", () => {
  it("writes the new content and leaves no temp file behind", () => {
    const filePath = path.join(tmpDir, "jest.config.js");
    fs.writeFileSync(filePath, "module.exports = {};\n");

    applyPatchAtomically({
      filePath,
      description: "d",
      snippet: "s",
      beforeContent: "module.exports = {};\n",
      newContent: "module.exports = { moduleNameMapper: {} };\n",
    });

    expect(fs.readFileSync(filePath, "utf8")).toBe(
      "module.exports = { moduleNameMapper: {} };\n"
    );
    const remaining = fs.readdirSync(tmpDir);
    expect(remaining).toEqual(["jest.config.js"]);
  });

  it("creates the file when it didn't exist before", () => {
    const filePath = path.join(tmpDir, "new.config.js");

    applyPatchAtomically({
      filePath,
      description: "d",
      snippet: "s",
      newContent: "module.exports = {};\n",
    });

    expect(fs.existsSync(filePath)).toBe(true);
    expect(fs.readFileSync(filePath, "utf8")).toBe("module.exports = {};\n");
  });

  it("throws when the patch has no newContent to apply", () => {
    expect(() =>
      applyPatchAtomically({
        filePath: path.join(tmpDir, "x.js"),
        description: "d",
        snippet: "s",
      })
    ).toThrow();
  });
});

describe("applyAndRerun", () => {
  it("applies the patch, reruns the command, and reports resolution", async () => {
    const filePath = path.join(tmpDir, "flag.txt");
    fs.writeFileSync(filePath, "unfixed");

    const patch: PatchProposal = {
      filePath,
      description: "flip the flag",
      snippet: "fixed",
      beforeContent: "unfixed",
      newContent: "fixed",
    };

    // A tiny script that succeeds only once the flag file says "fixed" --
    // simulates a real command whose failure the patch actually resolves.
    const script = `
      const fs = require('fs');
      const content = fs.readFileSync(${JSON.stringify(filePath)}, 'utf8');
      process.exit(content === 'fixed' ? 0 : 1);
    `;

    const runner = new NodeCommandRunner();
    const outcome = await applyAndRerun(
      patch,
      runner,
      [process.execPath, "-e", script],
      tmpDir
    );

    expect(outcome.applied).toBe(true);
    expect(outcome.resolved).toBe(true);
    expect(outcome.rerun.success).toBe(true);
    expect(fs.readFileSync(filePath, "utf8")).toBe("fixed");
  });

  it("reports resolved:false when the rerun still fails after the fix", async () => {
    const filePath = path.join(tmpDir, "flag.txt");
    fs.writeFileSync(filePath, "unfixed");

    const patch: PatchProposal = {
      filePath,
      description: "flip the flag to the wrong value",
      snippet: "still-wrong",
      beforeContent: "unfixed",
      newContent: "still-wrong",
    };

    const script = `
      const fs = require('fs');
      const content = fs.readFileSync(${JSON.stringify(filePath)}, 'utf8');
      process.exit(content === 'fixed' ? 0 : 1);
    `;

    const runner = new NodeCommandRunner();
    const outcome = await applyAndRerun(
      patch,
      runner,
      [process.execPath, "-e", script],
      tmpDir
    );

    expect(outcome.applied).toBe(true);
    expect(outcome.resolved).toBe(false);
  });
});
