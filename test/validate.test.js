// test/validate.test.js
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { validateFile } from "../src/validate.js";

describe("validateFile", () => {
  let tmpDir;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "dispatch-validate-"));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("returns valid for a correct config file", () => {
    const filePath = path.join(tmpDir, "rules.json");
    fs.writeFileSync(filePath, JSON.stringify({
      version: 2,
      config: { maxMatches: 5, minScore: 2 },
      rules: [{
        id: "test", name: "Test", category: "dev", command: "test",
        enforcement: "suggest", keywords: ["test"], patterns: [], description: "Test",
      }],
    }));
    const result = validateFile(filePath);
    expect(result.valid).toBe(true);
  });

  it("returns errors for invalid JSON", () => {
    const filePath = path.join(tmpDir, "rules.json");
    fs.writeFileSync(filePath, "not json {{{");
    const result = validateFile(filePath);
    expect(result.valid).toBe(false);
    expect(result.errors[0]).toMatch(/parse|json/i);
  });

  it("returns errors for missing file", () => {
    const result = validateFile(path.join(tmpDir, "nope.json"));
    expect(result.valid).toBe(false);
    expect(result.errors[0]).toMatch(/not found|read/i);
  });
});
