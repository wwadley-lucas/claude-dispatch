// src/router.js
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";

// --- Scoring ---

export function scoreRule(rule, promptLower, promptRaw) {
  let score = 0;
  const matchedTerms = [];

  for (const kw of rule.keywords) {
    if (promptLower.includes(kw.toLowerCase())) {
      score += 1;
      matchedTerms.push(kw);
    }
  }

  for (const pat of rule.patterns) {
    try {
      const re = new RegExp(pat, "i");
      if (re.test(promptRaw)) {
        score += 2;
        matchedTerms.push(`/${pat}/`);
      }
    } catch {
      // Invalid regex — skip
    }
  }

  return { score, matchedTerms };
}

export function layer1Match(rules, config, prompt) {
  const promptLower = prompt.toLowerCase();
  const results = [];

  for (const rule of rules) {
    const { score, matchedTerms } = scoreRule(rule, promptLower, prompt);
    const threshold = rule.minMatches || config.minScore || 2;
    if (score >= threshold) {
      results.push({
        id: rule.id,
        name: rule.name,
        category: rule.category,
        command: rule.command,
        enforcement: rule.enforcement,
        description: rule.description,
        score,
        keywordScore: score,
        contextScore: 0,
        contextSignals: [],
        matchedTerms,
        layer: 1,
      });
    }
  }

  results.sort((a, b) => b.score - a.score);
  return results.slice(0, (config.maxMatches || 5) * 2);
}

// --- Context Signals ---

function detectDirectoryContext(cwd, directorySignals) {
  if (!directorySignals) return {};
  const boosts = {};
  for (const entry of directorySignals) {
    try {
      const re = new RegExp(entry.pattern);
      if (re.test(cwd)) {
        for (const [cat, val] of Object.entries(entry.boosts)) {
          boosts[cat] = (boosts[cat] || 0) + val;
        }
      }
    } catch {
      // Invalid regex — skip
    }
  }
  return boosts;
}

function detectFileContext(cwd, fileTypeSignals) {
  if (!fileTypeSignals) return {};
  const boosts = {};
  try {
    const files = fs.readdirSync(cwd).slice(0, 50);
    const extCounts = {};
    for (const f of files) {
      const ext = path.extname(f).toLowerCase();
      if (ext) extCounts[ext] = (extCounts[ext] || 0) + 1;
    }
    for (const [ext, count] of Object.entries(extCounts)) {
      if (count >= 3 && fileTypeSignals[ext]) {
        for (const [cat, val] of Object.entries(fileTypeSignals[ext])) {
          boosts[cat] = (boosts[cat] || 0) + val;
        }
      }
    }
  } catch {
    // Can't read directory — skip
  }
  return boosts;
}

function detectProjectMarkers(cwd, projectMarkers) {
  if (!projectMarkers) return { boosts: {}, penalties: {} };
  const boosts = {};
  const penalties = {};

  const exists = (p) => {
    try {
      fs.accessSync(p);
      return true;
    } catch {
      return false;
    }
  };

  for (const marker of projectMarkers) {
    if (marker.file) {
      // Check cwd and walk up to 5 parents
      let found = false;
      let dir = cwd;
      for (let i = 0; i < 6; i++) {
        if (exists(path.join(dir, marker.file))) {
          found = true;
          break;
        }
        const parent = path.dirname(dir);
        if (parent === dir) break;
        dir = parent;
      }
      if (found && marker.boosts) {
        for (const [cat, val] of Object.entries(marker.boosts)) {
          boosts[cat] = (boosts[cat] || 0) + val;
        }
      }
    }
    if (marker.absent) {
      let found = false;
      let dir = cwd;
      for (let i = 0; i < 6; i++) {
        if (exists(path.join(dir, marker.absent))) {
          found = true;
          break;
        }
        const parent = path.dirname(dir);
        if (parent === dir) break;
        dir = parent;
      }
      if (!found && marker.penalties) {
        for (const [cat, val] of Object.entries(marker.penalties)) {
          penalties[cat] = (penalties[cat] || 0) + val;
        }
      }
    }
  }

  return { boosts, penalties };
}

function detectSessionSequence(skillSequences, historyPath) {
  if (!skillSequences || !historyPath) return {};
  try {
    const raw = fs.readFileSync(historyPath, "utf8");
    const hist = JSON.parse(raw);
    if (!hist.history || hist.history.length === 0) return {};

    const lastEntry = hist.history[hist.history.length - 1];
    if (Date.now() - lastEntry.ts > 2 * 60 * 60 * 1000) return {};

    const nextSkills = skillSequences[lastEntry.skill];
    if (!nextSkills) return {};

    const boosts = {};
    for (let i = 0; i < nextSkills.length; i++) {
      boosts[nextSkills[i]] = i === 0 ? 2 : 1;
    }
    return boosts;
  } catch {
    return {};
  }
}

/**
 * Apply context signals to Layer 1 matches.
 * @param {Array} matches - Layer 1 match results
 * @param {string} cwd - Current working directory
 * @param {object} signals - Signal config sections from dispatch-rules.json
 * @param {object} [overrides] - Test overrides for computed boosts (fileBoosts, sequenceBoosts, markerBoosts, markerPenalties)
 */
export function applyContextSignals(matches, cwd, signals, overrides = {}) {
  if (!matches || matches.length === 0) return matches;

  const dirBoosts = overrides.dirBoosts ?? detectDirectoryContext(cwd, signals.directorySignals);
  const fileBoosts = overrides.fileBoosts ?? detectFileContext(cwd, signals.fileTypeSignals);
  const { boosts: markerBoosts, penalties: markerPenalties } = overrides.markerBoosts !== undefined
    ? { boosts: overrides.markerBoosts, penalties: overrides.markerPenalties || {} }
    : detectProjectMarkers(cwd, signals.projectMarkers);
  const sequenceBoosts = overrides.sequenceBoosts ?? detectSessionSequence(signals.skillSequences, signals._historyPath);

  for (const match of matches) {
    let ctxScore = 0;
    const ctxSignals = [];
    const cat = match.category;

    if (dirBoosts[cat]) {
      ctxScore += dirBoosts[cat];
      ctxSignals.push(`dir:+${dirBoosts[cat]}`);
    }
    if (fileBoosts[cat]) {
      ctxScore += fileBoosts[cat];
      ctxSignals.push(`files:+${fileBoosts[cat]}`);
    }
    if (markerBoosts[cat]) {
      ctxScore += markerBoosts[cat];
      ctxSignals.push(`marker:+${markerBoosts[cat]}`);
    }
    if (markerPenalties[cat]) {
      ctxScore += markerPenalties[cat];
      ctxSignals.push(`marker:${markerPenalties[cat]}`);
    }
    if (sequenceBoosts[match.command]) {
      ctxScore += sequenceBoosts[match.command];
      ctxSignals.push(`seq:+${sequenceBoosts[match.command]}`);
    }

    match.contextScore = ctxScore;
    match.contextSignals = ctxSignals;
    match.score += ctxScore;
  }

  return matches;
}

// --- Main Route Function ---

export function route(prompt, cwd, rulesConfig, options = {}) {
  if (!prompt || prompt.length < 10) return [];
  if (prompt.startsWith("/")) return [];

  const { config, rules } = rulesConfig;
  if (!rules || rules.length === 0) return [];

  // Layer 1
  let matches = layer1Match(rules, config, prompt);

  // Layer 1.5
  if (matches.length > 0) {
    const signals = {
      directorySignals: rulesConfig.directorySignals,
      fileTypeSignals: rulesConfig.fileTypeSignals,
      skillSequences: rulesConfig.skillSequences,
      projectMarkers: rulesConfig.projectMarkers,
      _historyPath: options.historyPath,
    };
    matches = applyContextSignals(matches, cwd, signals);
    matches.sort((a, b) => b.score - a.score);
    matches = matches.slice(0, config.maxMatches || 5);
  }

  return matches;
}

// --- Caching ---

export function hashPrompt(prompt, cwd) {
  return crypto
    .createHash("md5")
    .update(prompt.slice(0, 200) + "|" + cwd)
    .digest("hex");
}

export function pruneCache(cache, ttl) {
  const now = Date.now();
  const pruned = {};
  for (const [key, entry] of Object.entries(cache)) {
    if (now - entry.ts < ttl) {
      pruned[key] = entry;
    }
  }
  return pruned;
}

// --- History ---

export function recordMatch(command, historyPath) {
  let hist;
  try {
    const raw = fs.readFileSync(historyPath, "utf8");
    hist = JSON.parse(raw);
  } catch {
    hist = { history: [], pid: null };
  }

  const pid = process.ppid || process.pid;
  if (hist.pid && hist.pid !== pid) {
    hist.history = [];
  }
  hist.pid = pid;
  hist.history.push({ skill: command, ts: Date.now() });
  if (hist.history.length > 10) {
    hist.history = hist.history.slice(-10);
  }

  try {
    fs.writeFileSync(historyPath, JSON.stringify(hist), "utf8");
  } catch {
    // Non-critical — skip
  }
}

// --- Output Formatting ---

export function formatOutput(matches) {
  if (!matches || matches.length === 0) return {};

  return {
    contextRouter: {
      matched: true,
      matchCount: matches.length,
      matches: matches.map((m) => ({
        id: m.id,
        name: m.name,
        command: m.command,
        enforcement: m.enforcement,
        description: m.description,
        score: m.score,
        keywordScore: m.keywordScore,
        contextScore: m.contextScore,
        contextSignals: m.contextSignals,
        layer: m.layer,
      })),
      instruction:
        "Present these matched skills to the user for confirmation before activating. " +
        "Only invoke Skill tool for skills the user explicitly approves. " +
        "If enforcement is 'block', require explicit acknowledgment. " +
        "If enforcement is 'silent', mention the skill without requiring action.",
    },
  };
}
