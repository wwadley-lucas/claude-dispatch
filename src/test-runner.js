// src/test-runner.js
import { route } from "./router.js";

export function dryRun(prompt, cwd, rulesConfig) {
  const matches = route(prompt, cwd, rulesConfig);
  return { prompt, cwd, matches };
}

export function formatDryRun(result) {
  if (result.matches.length === 0) {
    return `No matches found for: "${result.prompt || "(empty)"}"`;
  }

  const lines = [];
  lines.push(`Prompt: "${result.prompt}"`);
  lines.push(`CWD: ${result.cwd || "(default)"}`);
  lines.push("");
  lines.push("Matches:");
  lines.push("-".repeat(60));

  for (let i = 0; i < result.matches.length; i++) {
    const m = result.matches[i];
    lines.push(`  ${i + 1}. ${m.name} (${m.id})`);
    lines.push(`     command: ${m.command}`);
    lines.push(`     score: ${m.score} (keyword: ${m.keywordScore}, context: ${m.contextScore})`);
    lines.push(`     layer: ${m.layer}`);
    if (m.matchedTerms && m.matchedTerms.length > 0) {
      lines.push(`     matched: ${m.matchedTerms.join(", ")}`);
    }
    if (m.contextSignals && m.contextSignals.length > 0) {
      lines.push(`     signals: ${m.contextSignals.join(", ")}`);
    }
    lines.push("");
  }

  return lines.join("\n");
}
