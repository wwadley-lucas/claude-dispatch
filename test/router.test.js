// test/router.test.js
import { describe, it, expect } from "vitest";
import { scoreRule, layer1Match, applyContextSignals, route } from "../src/router.js";

const makeRule = (overrides = {}) => ({
  id: "test-rule",
  name: "Test Rule",
  category: "dev-workflows",
  command: "test:command",
  enforcement: "suggest",
  keywords: ["deploy", "release", "production"],
  patterns: ["\\bdeploy\\s+to\\b"],
  minMatches: 2,
  description: "Test rule",
  ...overrides,
});

describe("scoreRule", () => {
  it("scores keyword matches at +1 each", () => {
    const rule = makeRule();
    const result = scoreRule(rule, "deploy the release", "deploy the release");
    expect(result.score).toBe(2);
    expect(result.matchedTerms).toContain("deploy");
    expect(result.matchedTerms).toContain("release");
  });

  it("scores regex matches at +2 each", () => {
    const rule = makeRule();
    const result = scoreRule(rule, "deploy to production", "deploy to production");
    // "deploy" (+1) + "production" (+1) + /deploy\s+to/ (+2) = 4
    expect(result.score).toBe(4);
  });

  it("returns 0 for no matches", () => {
    const rule = makeRule();
    const result = scoreRule(rule, "hello world", "hello world");
    expect(result.score).toBe(0);
  });
});

describe("layer1Match", () => {
  const config = { maxMatches: 5, minScore: 2 };

  it("returns rules that meet threshold", () => {
    const rules = [makeRule()];
    const results = layer1Match(rules, config, "deploy the release");
    expect(results).toHaveLength(1);
    expect(results[0].id).toBe("test-rule");
    expect(results[0].layer).toBe(1);
  });

  it("excludes rules below threshold", () => {
    const rules = [makeRule({ minMatches: 5 })];
    const results = layer1Match(rules, config, "deploy something");
    expect(results).toHaveLength(0);
  });

  it("sorts by score descending", () => {
    const rules = [
      makeRule({ id: "low", keywords: ["test"], minMatches: 1 }),
      makeRule({ id: "high", keywords: ["deploy", "release", "ship", "production"], minMatches: 2 }),
    ];
    const results = layer1Match(rules, config, "deploy the release to production and ship it");
    expect(results[0].id).toBe("high");
  });
});

describe("applyContextSignals", () => {
  it("boosts matches by directory signals", () => {
    const matches = [{ id: "r1", category: "ui", score: 3, contextScore: 0, contextSignals: [], command: "x" }];
    const signals = {
      directorySignals: [{ pattern: "src/components", boosts: { ui: 2 } }],
    };
    const result = applyContextSignals(matches, "/project/src/components/Button", signals);
    expect(result[0].score).toBe(5);
    expect(result[0].contextSignals).toContain("dir:+2");
  });

  it("boosts matches by file type signals", () => {
    const matches = [{ id: "r1", category: "ui", score: 3, contextScore: 0, contextSignals: [], command: "x" }];
    const signals = { fileTypeSignals: { ".tsx": { ui: 1 } } };
    // We need to mock fs.readdirSync — test the signal application logic only
    // This test verifies the boost is applied when fileBoosts are provided
    const result = applyContextSignals(matches, "/tmp", signals, { fileBoosts: { ui: 1 } });
    expect(result[0].score).toBe(4);
  });

  it("applies skill sequence boosts", () => {
    const matches = [{ id: "r1", category: "dev", score: 2, contextScore: 0, contextSignals: [], command: "writing-plans" }];
    const signals = { skillSequences: { brainstorming: ["writing-plans"] } };
    const result = applyContextSignals(matches, "/tmp", signals, { sequenceBoosts: { "writing-plans": 2 } });
    expect(result[0].score).toBe(4);
    expect(result[0].contextSignals).toContain("seq:+2");
  });

  it("applies project marker penalties", () => {
    const matches = [{ id: "r1", category: "git-workflows", score: 3, contextScore: 0, contextSignals: [], command: "x" }];
    const signals = { projectMarkers: [{ absent: ".git", penalties: { "git-workflows": -2 } }] };
    const result = applyContextSignals(matches, "/tmp", signals, { markerBoosts: {}, markerPenalties: { "git-workflows": -2 } });
    expect(result[0].score).toBe(1);
  });
});

describe("route", () => {
  it("returns empty array for short prompts", () => {
    const config = { version: 2, config: { maxMatches: 5, minScore: 2 }, rules: [] };
    const result = route("hi", "/tmp", config);
    expect(result).toEqual([]);
  });

  it("returns empty array for slash commands", () => {
    const config = { version: 2, config: { maxMatches: 5, minScore: 2 }, rules: [makeRule()] };
    const result = route("/deploy to production now", "/tmp", config);
    expect(result).toEqual([]);
  });

  it("returns matches for valid prompts", () => {
    const config = { version: 2, config: { maxMatches: 5, minScore: 2 }, rules: [makeRule()] };
    const result = route("deploy the release to production", "/tmp", config);
    expect(result.length).toBeGreaterThan(0);
    expect(result[0].id).toBe("test-rule");
  });
});
