import { describe, it, expect } from "vitest";
import * as path from "path";
import { ProjectDetector } from "../../../src/detection/projectDetector";
import { ContextCollector } from "../../../src/context/contextCollector";
import { missingDependencyAnalyzer } from "../../../src/analyzers/node/missingDependency";
import { makeFailure } from "../../helpers/failureContext";

const FIXTURE = path.resolve(__dirname, "../../fixtures/missing-dependency");
const detector = new ProjectDetector();
const collector = new ContextCollector();

describe("missingDependencyAnalyzer", () => {
  const project = detector.detect(FIXTURE);
  const collected = collector.collect(project);

  it("flags a declared-but-uninstalled dependency", async () => {
    const failure = makeFailure({
      command: ["node", "index.js"],
      stderr: "Error: Cannot find module 'left-pad'\n",
    });

    expect(missingDependencyAnalyzer.canAnalyze({ failure, project, collected })).toBe(true);

    const findings = await missingDependencyAnalyzer.analyze({
      failure,
      project,
      collected,
    });

    expect(findings).toHaveLength(1);
    expect(findings[0].id).toBe("missing-dependency-not-installed");
    expect(findings[0].confidence).toBeGreaterThan(0.8);
    expect(findings[0].suggestedActions[0].description).toContain("npm install");
  });

  it("flags a completely undeclared dependency differently", async () => {
    const failure = makeFailure({
      stderr: "Error: Cannot find module 'totally-unlisted-pkg'\n",
    });

    const findings = await missingDependencyAnalyzer.analyze({
      failure,
      project,
      collected,
    });

    expect(findings).toHaveLength(1);
    expect(findings[0].id).toBe("missing-dependency-not-declared");
  });

  it("ignores Jest's 'from <file>' unresolved-import variant (handled by the alias analyzer instead)", async () => {
    const failure = makeFailure({
      stderr: "Cannot find module '@/modules/users' from 'src/users.test.ts'\n",
    });

    expect(
      missingDependencyAnalyzer.canAnalyze({ failure, project, collected })
    ).toBe(false);
  });

  it("ignores relative-path module errors (not a dependency issue)", async () => {
    const failure = makeFailure({
      stderr: "Error: Cannot find module './local-file'\n",
    });

    const findings = await missingDependencyAnalyzer.analyze({
      failure,
      project,
      collected,
    });

    expect(findings).toHaveLength(0);
  });

  it("does not fire on unrelated errors", () => {
    const failure = makeFailure({ stderr: "TypeError: x is not a function\n" });
    expect(
      missingDependencyAnalyzer.canAnalyze({ failure, project, collected })
    ).toBe(false);
  });
});
