// test/scaffold.test.js
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { scaffold } from "../src/scaffold.js";

describe("scaffold", () => {
  let tmpDir;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "dispatch-test-"));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("creates .claude/hooks/ directory structure", () => {
    const result = scaffold(tmpDir, {});
    expect(fs.existsSync(path.join(tmpDir, ".claude", "hooks"))).toBe(true);
    expect(result.hookCreated).toBe(true);
  });

  it("copies hook file to .claude/hooks/context-router.js", () => {
    scaffold(tmpDir, {});
    const hookPath = path.join(tmpDir, ".claude", "hooks", "context-router.js");
    expect(fs.existsSync(hookPath)).toBe(true);
    const content = fs.readFileSync(hookPath, "utf8");
    expect(content).toContain("contextRouter");
  });

  it("copies starter rules to .claude/dispatch-rules.json", () => {
    scaffold(tmpDir, {});
    const rulesPath = path.join(tmpDir, ".claude", "dispatch-rules.json");
    expect(fs.existsSync(rulesPath)).toBe(true);
    const config = JSON.parse(fs.readFileSync(rulesPath, "utf8"));
    expect(config.version).toBe(2);
    expect(config.rules.length).toBeGreaterThan(0);
  });

  it("does not overwrite existing rules file", () => {
    const rulesPath = path.join(tmpDir, ".claude", "dispatch-rules.json");
    fs.mkdirSync(path.join(tmpDir, ".claude"), { recursive: true });
    fs.writeFileSync(rulesPath, '{"version":2,"custom":true}');
    scaffold(tmpDir, {});
    const content = JSON.parse(fs.readFileSync(rulesPath, "utf8"));
    expect(content.custom).toBe(true);
  });

  it("overwrites rules with --force", () => {
    const rulesPath = path.join(tmpDir, ".claude", "dispatch-rules.json");
    fs.mkdirSync(path.join(tmpDir, ".claude"), { recursive: true });
    fs.writeFileSync(rulesPath, '{"version":2,"custom":true}');
    scaffold(tmpDir, { force: true });
    const content = JSON.parse(fs.readFileSync(rulesPath, "utf8"));
    expect(content.custom).toBeUndefined();
    expect(content.rules.length).toBeGreaterThan(0);
  });

  it("--update replaces hook but preserves rules", () => {
    const rulesPath = path.join(tmpDir, ".claude", "dispatch-rules.json");
    const hookPath = path.join(tmpDir, ".claude", "hooks", "context-router.js");
    fs.mkdirSync(path.join(tmpDir, ".claude", "hooks"), { recursive: true });
    fs.writeFileSync(rulesPath, '{"version":2,"custom":true}');
    fs.writeFileSync(hookPath, "// old hook");
    scaffold(tmpDir, { update: true });
    const hookContent = fs.readFileSync(hookPath, "utf8");
    expect(hookContent).toContain("contextRouter");
    const rulesContent = JSON.parse(fs.readFileSync(rulesPath, "utf8"));
    expect(rulesContent.custom).toBe(true);
  });

  it("creates .claude/settings.json with hook entry when file does not exist", () => {
    scaffold(tmpDir, {});
    const settingsPath = path.join(tmpDir, ".claude", "settings.json");
    expect(fs.existsSync(settingsPath)).toBe(true);
    const settings = JSON.parse(fs.readFileSync(settingsPath, "utf8"));
    expect(settings.hooks.UserPromptSubmit).toHaveLength(1);
    expect(settings.hooks.UserPromptSubmit[0].command).toBe("node .claude/hooks/context-router.js");
  });

  it("merges hook into existing settings.json without overwriting other config", () => {
    const settingsPath = path.join(tmpDir, ".claude", "settings.json");
    fs.mkdirSync(path.join(tmpDir, ".claude"), { recursive: true });
    fs.writeFileSync(settingsPath, JSON.stringify({ permissions: { allow: ["Read"] } }));
    scaffold(tmpDir, {});
    const settings = JSON.parse(fs.readFileSync(settingsPath, "utf8"));
    expect(settings.permissions.allow).toEqual(["Read"]);
    expect(settings.hooks.UserPromptSubmit).toHaveLength(1);
  });

  it("does not duplicate hook entry on repeated init", () => {
    scaffold(tmpDir, {});
    const result = scaffold(tmpDir, {});
    expect(result.settingsWired).toBe(false);
    const settingsPath = path.join(tmpDir, ".claude", "settings.json");
    const settings = JSON.parse(fs.readFileSync(settingsPath, "utf8"));
    expect(settings.hooks.UserPromptSubmit).toHaveLength(1);
  });

  it("does not clobber malformed settings.json", () => {
    const settingsPath = path.join(tmpDir, ".claude", "settings.json");
    fs.mkdirSync(path.join(tmpDir, ".claude"), { recursive: true });
    fs.writeFileSync(settingsPath, "not valid json {{{");
    const result = scaffold(tmpDir, {});
    expect(result.settingsWired).toBe(false);
    const raw = fs.readFileSync(settingsPath, "utf8");
    expect(raw).toBe("not valid json {{{");
  });
});
