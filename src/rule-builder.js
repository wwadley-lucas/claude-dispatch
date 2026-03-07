// src/rule-builder.js
// Error convention: buildRule() throws on invalid input. appendRule() returns { success, error? }.
import fs from "node:fs";
import path from "node:path";

export function buildRule(answers) {
  const id = answers.name
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, "")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");

  if (!id) {
    throw new Error('Rule name must contain at least one alphanumeric character');
  }

  return {
    id,
    name: answers.name,
    category: answers.category,
    command: answers.command,
    enforcement: answers.enforcement,
    keywords: answers.keywords.split(",").map((k) => k.trim()).filter(Boolean),
    patterns: answers.patterns ? answers.patterns.split(",").map((p) => p.trim()).filter(Boolean) : [],
    minMatches: (() => { const p = parseInt(answers.minMatches, 10); return Number.isNaN(p) ? 2 : p; })(),
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
    if (fs.lstatSync(filePath).isSymbolicLink()) {
      return { success: false, error: `Refusing to write through symlink: ${filePath}` };
    }
  } catch (e) {
    if (e.code !== 'ENOENT') return { success: false, error: `Cannot check path: ${e.message}` };
  }

  try {
    const tmpPath = filePath + ".tmp." + process.pid;
    fs.writeFileSync(tmpPath, JSON.stringify(config, null, 2) + "\n", "utf8");
    fs.renameSync(tmpPath, filePath);
  } catch (e) {
    return { success: false, error: `Cannot write file: ${e.message}` };
  }

  return { success: true, ruleId: rule.id };
}
