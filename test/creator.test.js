import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import {
  generateTestPrompt,
  createFile,
  resolveOutputPath,
  executeCreate,
} from "../src/creator.js";

describe("generateTestPrompt", () => {
  it("joins first 4 keywords", () => {
    const result = generateTestPrompt(["deploy", "release", "production", "staging", "ship"]);
    expect(result).toBe("deploy release production staging");
  });

  it("handles fewer than 4 keywords", () => {
    const result = generateTestPrompt(["test", "debug"]);
    expect(result).toBe("test debug");
  });
});

describe("resolveOutputPath", () => {
  it("resolves skill path to .claude/commands/", () => {
    const result = resolveOutputPath("/project", "skill", "my-skill");
    expect(result).toBe(path.join("/project", ".claude", "commands", "my-skill.md"));
  });

  it("resolves agent path to .claude/agents/", () => {
    const result = resolveOutputPath("/project", "agent", "my-agent");
    expect(result).toBe(path.join("/project", ".claude", "agents", "my-agent.md"));
  });
});

describe("createFile", () => {
  let tmpDir;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "dispatch-creator-"));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("creates a markdown file with frontmatter", () => {
    const filePath = path.join(tmpDir, ".claude", "commands", "test-skill.md");
    createFile(filePath, "Test Skill", "A test skill");
    expect(fs.existsSync(filePath)).toBe(true);
    const content = fs.readFileSync(filePath, "utf8");
    expect(content).toContain("name: Test Skill");
    expect(content).toContain("description: A test skill");
    expect(content).toContain("<!-- Add your instructions here -->");
  });

  it("creates parent directories", () => {
    const filePath = path.join(tmpDir, "deep", "nested", "skill.md");
    createFile(filePath, "Deep", "Nested skill");
    expect(fs.existsSync(filePath)).toBe(true);
  });
});

describe("executeCreate", () => {
  let tmpDir;
  let configPath;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "dispatch-create-"));
    const claudeDir = path.join(tmpDir, ".claude");
    fs.mkdirSync(claudeDir, { recursive: true });
    configPath = path.join(claudeDir, "dispatch-rules.json");
    fs.writeFileSync(
      configPath,
      JSON.stringify({
        version: 2,
        config: { maxMatches: 5, minScore: 2, cacheTTL: 300000, llmFallback: false, llmTimeout: 5000 },
        rules: [],
      })
    );
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  const makeAnswers = (overrides = {}) => ({
    name: "Deploy Helper",
    description: "Guides deployment",
    category: "dev-workflows",
    command: "deploy-helper",
    keywords: "deploy, staging, production, release",
    patterns: "\\bdeploy\\s+to\\b",
    enforcement: "suggest",
    minMatches: "2",
    ...overrides,
  });

  it("creates skill file and adds routing rule", () => {
    const results = executeCreate(tmpDir, configPath, "skill", makeAnswers());

    // File created
    const fileStep = results.steps.find((s) => s.step === "create-file");
    expect(fileStep.ok).toBe(true);
    expect(fs.existsSync(fileStep.path)).toBe(true);
    expect(fileStep.path).toContain("commands");

    // Rule added
    const ruleStep = results.steps.find((s) => s.step === "add-rule");
    expect(ruleStep.ok).toBe(true);

    // Validation passed
    const valStep = results.steps.find((s) => s.step === "validate");
    expect(valStep.ok).toBe(true);
  });

  it("creates agent file in agents directory", () => {
    const results = executeCreate(tmpDir, configPath, "agent", makeAnswers());
    const fileStep = results.steps.find((s) => s.step === "create-file");
    expect(fileStep.path).toContain("agents");
    expect(fs.existsSync(fileStep.path)).toBe(true);
  });

  it("auto-test finds the new rule", () => {
    const results = executeCreate(tmpDir, configPath, "skill", makeAnswers());
    const testStep = results.steps.find((s) => s.step === "auto-test");
    expect(testStep.ok).toBe(true);
    expect(testStep.prompt).toContain("deploy");
  });

  it("rejects invalid regex patterns", () => {
    const results = executeCreate(tmpDir, configPath, "skill", makeAnswers({ patterns: "(unclosed" }));
    const regexStep = results.steps.find((s) => s.step === "regex-check");
    expect(regexStep.ok).toBe(false);
  });

  it("rejects duplicate rule IDs", () => {
    executeCreate(tmpDir, configPath, "skill", makeAnswers());
    const results = executeCreate(tmpDir, configPath, "skill", makeAnswers());
    const ruleStep = results.steps.find((s) => s.step === "add-rule");
    expect(ruleStep.ok).toBe(false);
    expect(ruleStep.error).toMatch(/duplicate/i);
  });
});
