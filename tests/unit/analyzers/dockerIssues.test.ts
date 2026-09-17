import { describe, it, expect } from "vitest";
import { dockerIssuesAnalyzer } from "../../../src/analyzers/docker/dockerIssues";
import { makeFailure } from "../../helpers/failureContext";
import { makeProject, makeCollected } from "../../helpers/projectContext";

const project = makeProject({ hasDocker: true });
const collected = makeCollected();

describe("dockerIssuesAnalyzer", () => {
  it("recognizes the Docker daemon not running", async () => {
    const failure = makeFailure({
      stderr:
        "Cannot connect to the Docker daemon at unix:///var/run/docker.sock. Is the docker daemon running?\n",
    });

    expect(
      dockerIssuesAnalyzer.canAnalyze({ failure, project, collected })
    ).toBe(true);

    const findings = await dockerIssuesAnalyzer.analyze({
      failure,
      project,
      collected,
    });

    expect(findings.some((f) => f.id === "docker-daemon-not-running")).toBe(true);
  });

  it("recognizes a port-already-allocated error", async () => {
    const failure = makeFailure({
      stderr: "Error response from daemon: Bind for 0.0.0.0:5432 failed: port is already allocated\n",
    });

    const findings = await dockerIssuesAnalyzer.analyze({
      failure,
      project,
      collected,
    });

    expect(findings.some((f) => f.id === "docker-port-already-allocated")).toBe(true);
  });

  it("does not fire when the project has no Docker files", () => {
    const noDockerProject = makeProject({ hasDocker: false });
    const failure = makeFailure({
      stderr: "Cannot connect to the Docker daemon\n",
    });
    expect(
      dockerIssuesAnalyzer.canAnalyze({
        failure,
        project: noDockerProject,
        collected,
      })
    ).toBe(false);
  });
});
