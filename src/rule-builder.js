// src/rule-builder.js
import fs from "node:fs";

export function buildRule(answers) {
  const id = answers.name
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, "")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");

  return {
    id,
    name: answers.name,
    category: answers.category,
    command: answers.command,
    enforcement: answers.enforcement,
    keywords: answers.keywords.split(",").map((k) => k.trim()).filter(Boolean),
    patterns: answers.patterns ? answers.patterns.split(",").map((p) => p.trim()).filter(Boolean) : [],
    minMatches: parseInt(answers.minMatches, 10) || 2,
    description: answers.description,
  };
}

export function appendRule(filePath, rule) {
  let raw;
  try {
    raw = fs.readFileSync(filePath, "utf8");
  } catch {
    return { success: false, error: `Cannot read file: ${filePath}` };
  }

  let config;
  try {
    config = JSON.parse(raw);
  } catch {
    return { success: false, error: "Invalid JSON in config file" };
  }

  if (!config.rules) config.rules = [];

  if (config.rules.some((r) => r.id === rule.id)) {
    return { success: false, error: `Duplicate rule ID: "${rule.id}"` };
  }

  config.rules.push(rule);

  try {
    fs.writeFileSync(filePath, JSON.stringify(config, null, 2) + "\n", "utf8");
  } catch (e) {
    return { success: false, error: `Cannot write file: ${e.message}` };
  }

  return { success: true, ruleId: rule.id };
}
