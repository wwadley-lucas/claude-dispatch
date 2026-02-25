// src/scaffold.js
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const TEMPLATES_DIR = path.join(__dirname, "..", "templates");

export async function scaffold(targetDir, options = {}) {
  const claudeDir = path.join(targetDir, ".claude");
  const hooksDir = path.join(claudeDir, "hooks");
  const hookDest = path.join(hooksDir, "context-router.js");
  const rulesDest = path.join(claudeDir, "dispatch-rules.json");

  const hookSrc = path.join(TEMPLATES_DIR, "hook.js");
  const rulesSrc = path.join(TEMPLATES_DIR, "starter-rules.json");

  // Create directories
  fs.mkdirSync(hooksDir, { recursive: true });

  // Copy hook (always overwrite on init or update)
  fs.copyFileSync(hookSrc, hookDest);
  const hookCreated = true;

  // Copy rules (skip if exists, unless --force)
  let rulesCreated = false;
  if (options.update) {
    // --update: only replace hook, never touch rules
    rulesCreated = false;
  } else if (!fs.existsSync(rulesDest) || options.force) {
    fs.copyFileSync(rulesSrc, rulesDest);
    rulesCreated = true;
  }

  return { hookCreated, rulesCreated, hookPath: hookDest, rulesPath: rulesDest };
}
