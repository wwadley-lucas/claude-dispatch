// src/creator.js
import fs from "node:fs";
import path from "node:path";
import { buildRule, appendRule } from "./rule-builder.js";
import { validateFile } from "./validate.js";
import { dryRun, formatDryRun } from "./test-runner.js";
import { isUnsafeRegex } from "./schema.js";

/**
 * Generate a test prompt from keywords for auto-testing.
 * Takes the first 4 keywords and joins them.
 */
export function generateTestPrompt(keywords) {
  const prompt = keywords.slice(0, 4).join(" ");
  // route() requires prompts >= 10 chars; pad if needed
  return prompt.length >= 10 ? prompt : prompt + " test prompt";
}

/**
 * Create the skill/agent markdown file with minimal frontmatter.
 */
export function createFile(filePath, name, description) {
  const dir = path.dirname(filePath);
  fs.mkdirSync(dir, { recursive: true });

  const content = `---
name: ${name}
description: ${description}
---

<!-- Add your instructions here -->
`;

  try {
    if (fs.lstatSync(filePath).isSymbolicLink()) {
      throw new Error(`Refusing to write through symlink: ${filePath}`);
    }
  } catch (e) {
    if (e.code !== "ENOENT") throw e;
  }
  fs.writeFileSync(filePath, content, "utf8");
}

/**
 * Resolve the output path for a skill or agent.
 */
export function resolveOutputPath(targetDir, type, id) {
  const subdir = type === "skill" ? "commands" : "agents";
  return path.join(targetDir, ".claude", subdir, `${id}.md`);
}

/**
 * Run the full create wizard flow (non-interactive parts).
 * The interactive prompts happen in cli.js; this handles file creation,
 * rule addition, validation, and auto-test.
 */
export function executeCreate(targetDir, configPath, type, answers) {
  const rule = buildRule(answers);
  const filePath = resolveOutputPath(targetDir, type, rule.id);
  const results = { filePath, ruleId: rule.id, steps: [] };

  // Validate regex patterns for syntax and ReDoS safety
  for (const pat of rule.patterns) {
    try {
      new RegExp(pat);
    } catch (e) {
      results.steps.push({ step: "regex-check", ok: false, error: `Invalid regex "${pat}": ${e.message}` });
      return results;
    }
    if (isUnsafeRegex(pat)) {
      results.steps.push({ step: "regex-check", ok: false, error: `Unsafe regex (ReDoS risk) "${pat}": avoid nested quantifiers and quantified alternations` });
      return results;
    }
  }

  // Create the markdown file
  try {
    createFile(filePath, answers.name, answers.description);
    results.steps.push({ step: "create-file", ok: true, path: filePath });
  } catch (e) {
    results.steps.push({ step: "create-file", ok: false, error: e.message });
    return results;
  }

  // Add routing rule
  const ruleResult = appendRule(configPath, rule);
  if (ruleResult.success) {
    results.steps.push({ step: "add-rule", ok: true, ruleId: ruleResult.ruleId });
  } else {
    results.steps.push({ step: "add-rule", ok: false, error: ruleResult.error });
    return results;
  }

  // Validate config
  const validation = validateFile(configPath);
  results.steps.push({ step: "validate", ok: validation.valid, errors: validation.errors });

  // Auto-test
  try {
    const raw = fs.readFileSync(configPath, "utf8");
    const config = JSON.parse(raw);
    const testPrompt = generateTestPrompt(rule.keywords);
    const testResult = dryRun(testPrompt, targetDir, config);
    const matched = testResult.matches.some((m) => m.id === rule.id);
    results.steps.push({
      step: "auto-test",
      ok: matched,
      prompt: testPrompt,
      output: formatDryRun(testResult),
    });
  } catch (e) {
    results.steps.push({ step: "auto-test", ok: false, error: e.message });
  }

  return results;
}
