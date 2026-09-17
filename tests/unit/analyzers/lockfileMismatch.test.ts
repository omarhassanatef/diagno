import { describe, it, expect } from "vitest";
import * as path from "path";
import { ProjectDetector } from "../../../src/detection/projectDetector";
import { ContextCollector } from "../../../src/context/contextCollector";
import { lockfileMismatchAnalyzer } from "../../../src/analyzers/node/lockfileMismatch";
import { makeFailure } from "../../helpers/failureContext";

const FIXTURE = path.resolve(__dirname, "../../fixtures/lockfile-mismatch");
const detector = new ProjectDetector();
const collector = new ContextCollector();

describe("lockfileMismatchAnalyzer", () => {
  const project = detector.detect(FIXTURE);
  const collected = collector.collect(project);

  it("flags multiple lockfiles present", async () => {
    const failure = makeFailure({ command: ["npm", "install"] });

    expect(
      lockfileMismatchAnalyzer.canAnalyze({ failure, project, collected })
    ).toBe(true);

    const findings = await lockfileMismatchAnalyzer.analyze({
      failure,
      project,
      collected,
    });

    const multiLockfileFinding = findings.find(
      (f) => f.id === "multiple-lockfiles-present"
    );
    expect(multiLockfileFinding).toBeDefined();
    expect(multiLockfileFinding?.evidence).toHaveLength(2);
  });

  it("flags EUSAGE-style symptoms even with a single lockfile", async () => {
    // Simulate a single-lockfile project by overriding `lockfiles`.
    const singleLockfileProject = { ...project, lockfiles: ["package-lock.json"] };
    const failure = makeFailure({
      stderr: "npm ERR! code EUSAGE\nnpm ERR! `npm ci` can only install packages when your package.json and package-lock.json are in sync\n",
    });

    expect(
      lockfileMismatchAnalyzer.canAnalyze({
        failure,
        project: singleLockfileProject,
        collected,
      })
    ).toBe(true);
  });
});
