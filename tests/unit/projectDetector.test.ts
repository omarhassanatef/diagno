import { describe, it, expect } from "vitest";
import * as path from "path";
import { ProjectDetector } from "../../src/detection/projectDetector";

const FIXTURES = path.resolve(__dirname, "../fixtures");
const detector = new ProjectDetector();

describe("ProjectDetector", () => {
  it("detects a TypeScript + Jest project and finds its config files", () => {
    const root = path.join(FIXTURES, "jest-alias-mismatch");
    const project = detector.detect(root);

    expect(project.root).toBe(root);
    expect(project.hasTypeScript).toBe(true);
    expect(project.hasJest).toBe(true);
    expect(project.tsconfigPath).toBe(path.join(root, "tsconfig.json"));
    expect(project.jestConfigPath).toBe(path.join(root, "jest.config.js"));
  });

  it("detects multiple lockfiles", () => {
    const root = path.join(FIXTURES, "lockfile-mismatch");
    const project = detector.detect(root);

    expect(project.lockfiles.sort()).toEqual(
      ["package-lock.json", "yarn.lock"].sort()
    );
  });

  it("detects a declared node engine range", () => {
    const root = path.join(FIXTURES, "node-version-mismatch");
    const project = detector.detect(root);

    expect(project.nodeEngineRange).toBe("<=1.0.0");
  });

  it("detects the presence of a .env file without reading its values", () => {
    const root = path.join(FIXTURES, "missing-env-var");
    const project = detector.detect(root);

    expect(project.hasEnvFile).toBe(true);
  });

  it("walks up from a subdirectory to find the project root", () => {
    const root = path.join(FIXTURES, "jest-alias-mismatch");
    const subdir = path.join(root, "src");
    const project = detector.detect(subdir);

    expect(project.root).toBe(root);
  });
});
