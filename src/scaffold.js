// src/scaffold.js
// Error convention: scaffold() returns a result object (never throws for expected failures).
// wireSettings() returns { wired: boolean, reason?: string } to distinguish failure modes.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const TEMPLATES_DIR = path.join(__dirname, "..", "templates");

const HOOK_ENTRY = {
  matcher: "",
  command: "node .claude/hooks/context-router.js",
};

export function scaffold(targetDir, options = {}) {
  const claudeDir = path.join(targetDir, ".claude");
  const hooksDir = path.join(claudeDir, "hooks");
  const hookDest = path.join(hooksDir, "context-router.js");
  const rulesDest = path.join(claudeDir, "dispatch-rules.json");
  const settingsPath = path.join(claudeDir, "settings.json");

  const hookSrc = path.join(TEMPLATES_DIR, "hook.js");
  const rulesSrc = path.join(TEMPLATES_DIR, "starter-rules.json");

  // Create directories
  fs.mkdirSync(hooksDir, { recursive: true });

  // Copy hook (always overwrite on init or update, but refuse symlinks)
  try {
    if (fs.lstatSync(hookDest).isSymbolicLink()) {
      throw new Error(`Refusing to write through symlink: ${hookDest}`);
    }
  } catch (e) {
    if (e.code !== "ENOENT") throw e;
  }
  fs.copyFileSync(hookSrc, hookDest);

  // Copy rules (skip if exists, unless --force)
  let rulesCreated = false;
  if (options.update) {
    // --update: only replace hook, never touch rules
    rulesCreated = false;
  } else if (!fs.existsSync(rulesDest) || options.force) {
    try {
      if (fs.lstatSync(rulesDest).isSymbolicLink()) {
        throw new Error(`Refusing to write through symlink: ${rulesDest}`);
      }
    } catch (e) {
      if (e.code !== "ENOENT") throw e;
    }
    fs.copyFileSync(rulesSrc, rulesDest);
    rulesCreated = true;
  }

  // Wire hook into .claude/settings.json
  const settingsResult = wireSettings(settingsPath);

  return { hookCreated: true, rulesCreated, settingsWired: settingsResult.wired, settingsReason: settingsResult.reason, hookPath: hookDest, rulesPath: rulesDest, settingsPath };
}

function wireSettings(settingsPath) {
  let settings = {};

  if (fs.existsSync(settingsPath)) {
    try {
      settings = JSON.parse(fs.readFileSync(settingsPath, "utf8"));
    } catch {
      // Malformed JSON — don't clobber it, bail out
      return { wired: false, reason: 'malformed_json' };
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
    return { wired: false, reason: 'already_exists' };
  }

  try {
    if (fs.lstatSync(settingsPath).isSymbolicLink()) {
      return { wired: false, reason: 'symlink' };
    }
  } catch (e) {
    if (e.code !== 'ENOENT') return { wired: false, reason: 'error' };
  }

  settings.hooks.UserPromptSubmit.push(HOOK_ENTRY);
  const tmp = settingsPath + ".tmp." + process.pid;
  fs.writeFileSync(tmp, JSON.stringify(settings, null, 2) + "\n");
  fs.renameSync(tmp, settingsPath);
  return { wired: true };
}
