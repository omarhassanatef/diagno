import { describe, it, expect } from "vitest";
import { renderUnifiedDiff } from "../../../src/fixes/diff";

describe("renderUnifiedDiff", () => {
  it("produces a standard unified diff with +/- lines", () => {
    const diff = renderUnifiedDiff(
      "jest.config.js",
      'module.exports = {\n  testEnvironment: "node"\n};\n',
      'module.exports = {\n  moduleNameMapper: {\n    "^@/(.*)$": "<rootDir>/src/$1"\n  },\n  testEnvironment: "node"\n};\n'
    );

    expect(diff).toContain("jest.config.js");
    expect(diff).toContain("+  moduleNameMapper: {");
    expect(diff).toContain('testEnvironment: "node"');
  });

  it("labels a brand-new file (no prior content) distinctly", () => {
    const diff = renderUnifiedDiff("jest.config.js", undefined, "module.exports = {};\n");
    expect(diff).toContain("(new file)");
    expect(diff).toContain("+module.exports = {};");
  });
});
