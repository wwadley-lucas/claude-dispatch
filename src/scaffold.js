// src/scaffold.js
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const TEMPLATES_DIR = path.join(__dirname, "..", "templates");

const HOOK_ENTRY = {
  matcher: "",
  command: "node .claude/hooks/context-router.js",
};

export async function scaffold(targetDir, options = {}) {
  const claudeDir = path.join(targetDir, ".claude");
  const hooksDir = path.join(claudeDir, "hooks");
  const hookDest = path.join(hooksDir, "context-router.js");
  const rulesDest = path.join(claudeDir, "dispatch-rules.json");
  const settingsPath = path.join(claudeDir, "settings.json");

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

  // Wire hook into .claude/settings.json
  const settingsWired = wireSettings(settingsPath);

  return { hookCreated, rulesCreated, settingsWired, hookPath: hookDest, rulesPath: rulesDest, settingsPath };
}

function wireSettings(settingsPath) {
  let settings = {};

  if (fs.existsSync(settingsPath)) {
    try {
      settings = JSON.parse(fs.readFileSync(settingsPath, "utf8"));
    } catch {
      // Malformed JSON — don't clobber it, bail out
      return false;
    }
  }

  if (!settings.hooks) {
    settings.hooks = {};
  }
  if (!Array.isArray(settings.hooks.UserPromptSubmit)) {
    settings.hooks.UserPromptSubmit = [];
  }

  // Check if our hook is already wired
  const alreadyWired = settings.hooks.UserPromptSubmit.some(
    (h) => h.command === HOOK_ENTRY.command,
  );
  if (alreadyWired) {
    return false;
  }

  settings.hooks.UserPromptSubmit.push(HOOK_ENTRY);
  fs.writeFileSync(settingsPath, JSON.stringify(settings, null, 2) + "\n");
  return true;
}
