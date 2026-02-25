// test/test-runner.test.js
import { describe, it, expect } from "vitest";
import { dryRun, formatDryRun } from "../src/test-runner.js";

describe("dryRun", () => {
  const config = {
    version: 2,
    config: { maxMatches: 5, minScore: 2 },
    rules: [{
      id: "deploy", name: "Deployment", category: "dev-workflows", command: "deploy",
      enforcement: "suggest", keywords: ["deploy", "release", "production"],
      patterns: ["\\bdeploy\\s+to\\b"], description: "Deploy to environments",
    }],
  };

  it("returns matches for matching prompt", () => {
    const result = dryRun("deploy the release to production", "/tmp", config);
    expect(result.matches.length).toBeGreaterThan(0);
    expect(result.matches[0].id).toBe("deploy");
  });

  it("returns empty for non-matching prompt", () => {
    const result = dryRun("hello world how are you", "/tmp", config);
    expect(result.matches).toHaveLength(0);
  });
});

describe("formatDryRun", () => {
  it("formats matches into readable output", () => {
    const result = {
      matches: [{
        id: "deploy", name: "Deployment", command: "deploy", score: 4,
        keywordScore: 2, contextScore: 2, matchedTerms: ["deploy", "release"],
        contextSignals: ["marker:+2"], layer: 1,
      }],
    };
    const output = formatDryRun(result);
    expect(output).toContain("deploy");
    expect(output).toContain("Deployment");
    expect(output).toContain("score");
  });

  it("shows 'no matches' for empty results", () => {
    const output = formatDryRun({ matches: [] });
    expect(output).toMatch(/no match/i);
  });
});
