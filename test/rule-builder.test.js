// test/rule-builder.test.js
import { describe, it, expect } from "vitest";
import { buildRule, appendRule } from "../src/rule-builder.js";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";

describe("buildRule", () => {
  it("generates a rule object from answers", () => {
    const answers = {
      name: "My Custom Skill",
      category: "dev-workflows",
      command: "my-skill",
      keywords: "build, compile, make",
      patterns: "\\bbuild\\s+the\\b",
      enforcement: "suggest",
      minMatches: "2",
      description: "Build and compile projects",
    };
    const rule = buildRule(answers);
    expect(rule.id).toBe("my-custom-skill");
    expect(rule.name).toBe("My Custom Skill");
    expect(rule.keywords).toEqual(["build", "compile", "make"]);
    expect(rule.patterns).toEqual(["\\bbuild\\s+the\\b"]);
    expect(rule.minMatches).toBe(2);
  });

  it("generates kebab-case ID from name", () => {
    const rule = buildRule({
      name: "Some Complex  Skill Name!",
      category: "dev", command: "x", keywords: "a", patterns: "",
      enforcement: "suggest", minMatches: "2", description: "Test",
    });
    expect(rule.id).toBe("some-complex-skill-name");
  });
});

describe("appendRule", () => {
  it("appends a rule to an existing config file", () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "dispatch-rule-"));
    const filePath = path.join(tmpDir, "rules.json");
    fs.writeFileSync(filePath, JSON.stringify({
      version: 2, config: { maxMatches: 5, minScore: 2 }, rules: [],
    }));

    const rule = {
      id: "new-rule", name: "New Rule", category: "dev",
      command: "new", enforcement: "suggest", keywords: ["new"],
      patterns: [], description: "A new rule",
    };
    const result = appendRule(filePath, rule);
    expect(result.success).toBe(true);

    const config = JSON.parse(fs.readFileSync(filePath, "utf8"));
    expect(config.rules).toHaveLength(1);
    expect(config.rules[0].id).toBe("new-rule");

    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("rejects duplicate IDs", () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "dispatch-rule-"));
    const filePath = path.join(tmpDir, "rules.json");
    fs.writeFileSync(filePath, JSON.stringify({
      version: 2, config: { maxMatches: 5, minScore: 2 },
      rules: [{ id: "existing", name: "X", category: "dev", command: "x", enforcement: "suggest", keywords: ["x"], patterns: [], description: "X" }],
    }));

    const rule = { id: "existing", name: "Dupe", category: "dev", command: "x", enforcement: "suggest", keywords: ["x"], patterns: [], description: "X" };
    const result = appendRule(filePath, rule);
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/duplicate/i);

    fs.rmSync(tmpDir, { recursive: true, force: true });
  });
});
