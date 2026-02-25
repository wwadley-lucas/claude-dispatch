import { describe, it, expect } from "vitest";
import { validateConfig } from "../src/schema.js";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const starterRules = JSON.parse(readFileSync(join(__dirname, "..", "templates", "starter-rules.json"), "utf8"));

describe("starter-rules.json", () => {
  it("passes schema validation", () => {
    const result = validateConfig(starterRules);
    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  it("has 12 rules", () => {
    expect(starterRules.rules).toHaveLength(12);
  });

  it("has no duplicate IDs", () => {
    const ids = starterRules.rules.map((r) => r.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});
