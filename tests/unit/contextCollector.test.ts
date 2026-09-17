import { describe, it, expect } from "vitest";
import * as path from "path";
import { ProjectDetector } from "../../src/detection/projectDetector";
import { ContextCollector } from "../../src/context/contextCollector";

const FIXTURES = path.resolve(__dirname, "../fixtures");
const detector = new ProjectDetector();
const collector = new ContextCollector();

describe("ContextCollector", () => {
  it("reads tsconfig.json and jest config content", () => {
    const project = detector.detect(path.join(FIXTURES, "jest-alias-mismatch"));
    const collected = collector.collect(project);

    expect(collected.tsconfigContent).toContain('"@/*"');
    expect(collected.jestConfigContent).toContain("testEnvironment");
  });

  it("extracts only .env key names, never values", () => {
    const project = detector.detect(path.join(FIXTURES, "missing-env-var"));
    const collected = collector.collect(project);

    expect(collected.envKeys.sort()).toEqual(["ANOTHER_KEY", "OTHER_KEY"].sort());
    // The value must never leak into any collected field.
    const serialized = JSON.stringify(collected);
    expect(serialized).not.toContain("some-value");
    expect(serialized).not.toContain("another-value");
  });

  it("reports whether a package is installed on disk", () => {
    const project = detector.detect(path.join(FIXTURES, "missing-dependency"));

    expect(collector.isInstalled(project, "left-pad")).toBe(false);
  });
});
