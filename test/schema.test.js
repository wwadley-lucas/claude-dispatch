// test/schema.test.js
import { describe, it, expect } from "vitest";
import { validateConfig } from "../src/schema.js";

describe("validateConfig", () => {
  const validRule = {
    id: "test-rule",
    name: "Test Rule",
    category: "dev-workflows",
    command: "test:command",
    enforcement: "suggest",
    keywords: ["test", "example"],
    patterns: ["\\btest\\b"],
    description: "A test rule",
  };

  const validConfig = {
    version: 2,
    config: { maxMatches: 5, minScore: 2, cacheTTL: 300000, llmFallback: false, llmTimeout: 5000 },
    rules: [validRule],
  };

  it("accepts a valid config", () => {
    const result = validateConfig(validConfig);
    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  it("rejects missing version", () => {
    const result = validateConfig({ ...validConfig, version: undefined });
    expect(result.valid).toBe(false);
    expect(result.errors[0]).toMatch(/version/i);
  });

  it("rejects missing required rule fields", () => {
    const result = validateConfig({
      ...validConfig,
      rules: [{ id: "incomplete" }],
    });
    expect(result.valid).toBe(false);
    expect(result.errors.length).toBeGreaterThan(0);
  });

  it("rejects duplicate rule IDs", () => {
    const result = validateConfig({
      ...validConfig,
      rules: [validRule, { ...validRule }],
    });
    expect(result.valid).toBe(false);
    expect(result.errors[0]).toMatch(/duplicate/i);
  });

  it("rejects invalid regex patterns", () => {
    const result = validateConfig({
      ...validConfig,
      rules: [{ ...validRule, patterns: ["(unclosed"] }],
    });
    expect(result.valid).toBe(false);
    expect(result.errors[0]).toMatch(/regex|pattern/i);
  });

  it("rejects invalid enforcement values", () => {
    const result = validateConfig({
      ...validConfig,
      rules: [{ ...validRule, enforcement: "yolo" }],
    });
    expect(result.valid).toBe(false);
    expect(result.errors[0]).toMatch(/enforcement/i);
  });

  it("accepts optional directorySignals", () => {
    const result = validateConfig({
      ...validConfig,
      directorySignals: [{ pattern: "src/components", boosts: { ui: 2 } }],
    });
    expect(result.valid).toBe(true);
  });

  it("rejects directorySignals with invalid boosts", () => {
    const result = validateConfig({
      ...validConfig,
      directorySignals: [{ pattern: "src", boosts: "not-an-object" }],
    });
    expect(result.valid).toBe(false);
  });

  it("accepts optional fileTypeSignals", () => {
    const result = validateConfig({
      ...validConfig,
      fileTypeSignals: { ".tsx": { ui: 2 } },
    });
    expect(result.valid).toBe(true);
  });

  it("accepts optional skillSequences", () => {
    const result = validateConfig({
      ...validConfig,
      skillSequences: { "brainstorming": ["writing-plans"] },
    });
    expect(result.valid).toBe(true);
  });

  it("accepts optional projectMarkers", () => {
    const result = validateConfig({
      ...validConfig,
      projectMarkers: [
        { file: "package.json", boosts: { dev: 1 } },
        { absent: ".git", penalties: { git: -2 } },
      ],
    });
    expect(result.valid).toBe(true);
  });

  it("rejects projectMarkers with neither file nor absent", () => {
    const result = validateConfig({
      ...validConfig,
      projectMarkers: [{ boosts: { dev: 1 } }],
    });
    expect(result.valid).toBe(false);
  });
});
