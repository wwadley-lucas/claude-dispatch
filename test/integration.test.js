// test/integration.test.js
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";

const CLI = path.join(import.meta.dirname, "..", "bin", "cli.js");

describe("CLI integration", () => {
  let tmpDir;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "dispatch-int-"));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("init creates hook and config", () => {
    execFileSync("node", [CLI, "init"], { cwd: tmpDir });
    expect(fs.existsSync(path.join(tmpDir, ".claude", "hooks", "context-router.js"))).toBe(true);
    expect(fs.existsSync(path.join(tmpDir, ".claude", "dispatch-rules.json"))).toBe(true);
  });

  it("validate passes on init config", () => {
    execFileSync("node", [CLI, "init"], { cwd: tmpDir });
    const result = execFileSync("node", [CLI, "validate", "-f", path.join(tmpDir, ".claude", "dispatch-rules.json")], {
      cwd: tmpDir, encoding: "utf8",
    });
    expect(result).toContain("Valid");
  });

  it("test shows matches for matching prompt", () => {
    execFileSync("node", [CLI, "init"], { cwd: tmpDir });
    const result = execFileSync("node", [CLI, "test", "deploy the release to production now", "-f", path.join(tmpDir, ".claude", "dispatch-rules.json")], {
      cwd: tmpDir, encoding: "utf8",
    });
    expect(result).toContain("Deployment");
  });

  it("test shows no matches for unrelated prompt", () => {
    execFileSync("node", [CLI, "init"], { cwd: tmpDir });
    const result = execFileSync("node", [CLI, "test", "hello how are you today", "-f", path.join(tmpDir, ".claude", "dispatch-rules.json")], {
      cwd: tmpDir, encoding: "utf8",
    });
    expect(result).toMatch(/no match/i);
  });

  it("init --update preserves config", () => {
    execFileSync("node", [CLI, "init"], { cwd: tmpDir });
    const rulesPath = path.join(tmpDir, ".claude", "dispatch-rules.json");
    const config = JSON.parse(fs.readFileSync(rulesPath, "utf8"));
    config.custom = true;
    fs.writeFileSync(rulesPath, JSON.stringify(config));
    execFileSync("node", [CLI, "init", "--update"], { cwd: tmpDir });
    const updated = JSON.parse(fs.readFileSync(rulesPath, "utf8"));
    expect(updated.custom).toBe(true);
  });
});
