#!/usr/bin/env node
// bin/cli.js
import { Command } from "commander";
import { createRequire } from "node:module";
import path from "node:path";
import { scaffold } from "../src/scaffold.js";
import { validateFile } from "../src/validate.js";
import { dryRun, formatDryRun } from "../src/test-runner.js";
import { buildRule, appendRule } from "../src/rule-builder.js";
import fs from "node:fs";

const require = createRequire(import.meta.url);
const pkg = require("../package.json");

const program = new Command();

program
  .name("claude-dispatch")
  .description("Context-aware skill router for Claude Code hooks")
  .version(pkg.version);

// --- init ---
program
  .command("init")
  .description("Scaffold the dispatch hook and config into .claude/")
  .option("--update", "Replace hook only, preserve config")
  .option("--force", "Overwrite everything including config")
  .action(async (opts) => {
    const targetDir = process.cwd();
    console.log(`Initializing claude-dispatch in ${targetDir}...`);

    const result = await scaffold(targetDir, {
      update: opts.update,
      force: opts.force,
    });

    console.log(`  Hook: ${result.hookPath}`);
    if (result.rulesCreated) {
      console.log(`  Config: ${result.rulesPath}`);
    } else if (opts.update) {
      console.log("  Config: preserved (--update)");
    } else {
      console.log(`  Config: already exists (use --force to overwrite)`);
    }
    console.log("\nDone! Edit .claude/dispatch-rules.json to configure your skill routing.");
  });

// --- validate ---
program
  .command("validate")
  .description("Validate dispatch-rules.json against the schema")
  .option("-f, --file <path>", "Path to config file", ".claude/dispatch-rules.json")
  .action((opts) => {
    const filePath = path.resolve(opts.file);
    const result = validateFile(filePath);

    if (result.valid) {
      console.log(`Valid: ${filePath}`);
      process.exit(0);
    } else {
      console.error(`Invalid: ${filePath}`);
      for (const err of result.errors) {
        console.error(`  - ${err}`);
      }
      process.exit(1);
    }
  });

// --- test ---
program
  .command("test <prompt>")
  .description("Dry-run a prompt to see which rules match")
  .option("-f, --file <path>", "Path to config file", ".claude/dispatch-rules.json")
  .action((prompt, opts) => {
    const filePath = path.resolve(opts.file);

    let raw;
    try {
      raw = fs.readFileSync(filePath, "utf8");
    } catch {
      console.error(`Cannot read config: ${filePath}`);
      process.exit(1);
    }

    let config;
    try {
      config = JSON.parse(raw);
    } catch {
      console.error(`Invalid JSON in: ${filePath}`);
      process.exit(1);
    }

    const result = dryRun(prompt, process.cwd(), config);
    console.log(formatDryRun(result));
  });

// --- add-rule ---
program
  .command("add-rule")
  .description("Interactively add a new routing rule")
  .option("-f, --file <path>", "Path to config file", ".claude/dispatch-rules.json")
  .action(async (opts) => {
    const filePath = path.resolve(opts.file);

    if (!fs.existsSync(filePath)) {
      console.error(`Config not found: ${filePath}`);
      console.error("Run 'claude-dispatch init' first.");
      process.exit(1);
    }

    const { default: inquirer } = await import("inquirer");

    const answers = await inquirer.prompt([
      { type: "input", name: "name", message: "Rule name:", validate: (v) => v.length > 0 || "Required" },
      { type: "input", name: "category", message: "Category (e.g., dev-workflows, code-quality):" },
      { type: "input", name: "command", message: "Skill command to invoke:" },
      { type: "input", name: "keywords", message: "Keywords (comma-separated):" },
      { type: "input", name: "patterns", message: "Regex patterns (comma-separated, optional):" },
      { type: "list", name: "enforcement", message: "Enforcement level:", choices: ["suggest", "silent", "block"], default: "suggest" },
      { type: "input", name: "minMatches", message: "Minimum score threshold:", default: "2" },
      { type: "input", name: "description", message: "Description:" },
    ]);

    const rule = buildRule(answers);

    // Validate regex patterns
    for (const pat of rule.patterns) {
      try {
        new RegExp(pat);
      } catch (e) {
        console.error(`Invalid regex pattern "${pat}": ${e.message}`);
        process.exit(1);
      }
    }

    const result = appendRule(filePath, rule);
    if (result.success) {
      console.log(`\nAdded rule "${result.ruleId}" to ${filePath}`);

      // Auto-validate
      const validation = validateFile(filePath);
      if (validation.valid) {
        console.log("Config validation: passed");
      } else {
        console.error("Config validation: FAILED");
        for (const err of validation.errors) {
          console.error(`  - ${err}`);
        }
      }
    } else {
      console.error(`Failed: ${result.error}`);
      process.exit(1);
    }
  });

program.parse();
