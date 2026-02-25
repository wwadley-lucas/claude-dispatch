# claude-dispatch Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Build and ship an npm package that installs a context-aware skill router as a Claude Code hook.

**Architecture:** Self-contained JS hook reads `dispatch-rules.json` for all routing config. npm package provides CLI (`init`, `validate`, `test`, `add-rule`) to scaffold, validate, and test the setup. Three-layer scoring: keyword/regex → context signals → LLM fallback.

**Tech Stack:** Node.js (>=18), commander (CLI), inquirer (interactive prompts), vitest (testing)

**Design Doc:** `docs/plans/2026-02-25-claude-dispatch-design.md`

---

### Task 1: Project Bootstrap

**Files:**
- Create: `package.json`
- Create: `.gitignore`
- Create: `vitest.config.js`

**Step 1: Create package.json**

```json
{
  "name": "claude-dispatch",
  "version": "0.1.0",
  "description": "Context-aware skill router for Claude Code hooks",
  "type": "module",
  "bin": {
    "claude-dispatch": "./bin/cli.js"
  },
  "main": "src/router.js",
  "scripts": {
    "test": "vitest run",
    "test:watch": "vitest"
  },
  "keywords": ["claude", "claude-code", "hooks", "skill-router", "context-router"],
  "author": "Lucas Wadley",
  "license": "MIT",
  "dependencies": {
    "commander": "^13.0.0",
    "inquirer": "^12.0.0"
  },
  "devDependencies": {
    "vitest": "^3.0.0"
  },
  "engines": {
    "node": ">=18.0.0"
  },
  "files": [
    "bin/",
    "src/",
    "templates/",
    "README.md",
    "LICENSE"
  ]
}
```

**Step 2: Create .gitignore**

```
node_modules/
coverage/
.DS_Store
*.log
```

**Step 3: Create vitest.config.js**

```js
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    globals: true,
  },
});
```

**Step 4: Install dependencies**

Run: `cd ~/claude-dispatch && npm install`
Expected: `node_modules/` created, lock file generated

**Step 5: Verify test runner works**

Create `test/smoke.test.js`:
```js
import { describe, it, expect } from "vitest";

describe("smoke test", () => {
  it("works", () => {
    expect(1 + 1).toBe(2);
  });
});
```

Run: `npm test`
Expected: 1 test passes

**Step 6: Commit**

```bash
git add package.json package-lock.json .gitignore vitest.config.js test/smoke.test.js
git commit -m "chore: bootstrap project with package.json, vitest, and directory structure"
```

---

### Task 2: Schema Validation

**Files:**
- Create: `src/schema.js`
- Create: `test/schema.test.js`

**Step 1: Write failing tests for schema validation**

```js
// test/schema.test.js
import { describe, it, expect } from "vitest";
import { validateConfig } from "../src/schema.js";

describe("validateConfig", () => {
  const validRule = {
    id: "test-rule",
    name: "Test Rule",
    category: "dev-workflows",
    command: "test:command",
    enforcement: "suggest",
    keywords: ["test", "example"],
    patterns: ["\\btest\\b"],
    description: "A test rule",
  };

  const validConfig = {
    version: 2,
    config: { maxMatches: 5, minScore: 2, cacheTTL: 300000, llmFallback: false, llmTimeout: 5000 },
    rules: [validRule],
  };

  it("accepts a valid config", () => {
    const result = validateConfig(validConfig);
    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  it("rejects missing version", () => {
    const result = validateConfig({ ...validConfig, version: undefined });
    expect(result.valid).toBe(false);
    expect(result.errors[0]).toMatch(/version/i);
  });

  it("rejects missing required rule fields", () => {
    const result = validateConfig({
      ...validConfig,
      rules: [{ id: "incomplete" }],
    });
    expect(result.valid).toBe(false);
    expect(result.errors.length).toBeGreaterThan(0);
  });

  it("rejects duplicate rule IDs", () => {
    const result = validateConfig({
      ...validConfig,
      rules: [validRule, { ...validRule }],
    });
    expect(result.valid).toBe(false);
    expect(result.errors[0]).toMatch(/duplicate/i);
  });

  it("rejects invalid regex patterns", () => {
    const result = validateConfig({
      ...validConfig,
      rules: [{ ...validRule, patterns: ["(unclosed"] }],
    });
    expect(result.valid).toBe(false);
    expect(result.errors[0]).toMatch(/regex|pattern/i);
  });

  it("rejects invalid enforcement values", () => {
    const result = validateConfig({
      ...validConfig,
      rules: [{ ...validRule, enforcement: "yolo" }],
    });
    expect(result.valid).toBe(false);
    expect(result.errors[0]).toMatch(/enforcement/i);
  });

  it("accepts optional directorySignals", () => {
    const result = validateConfig({
      ...validConfig,
      directorySignals: [{ pattern: "src/components", boosts: { ui: 2 } }],
    });
    expect(result.valid).toBe(true);
  });

  it("rejects directorySignals with invalid boosts", () => {
    const result = validateConfig({
      ...validConfig,
      directorySignals: [{ pattern: "src", boosts: "not-an-object" }],
    });
    expect(result.valid).toBe(false);
  });

  it("accepts optional fileTypeSignals", () => {
    const result = validateConfig({
      ...validConfig,
      fileTypeSignals: { ".tsx": { ui: 2 } },
    });
    expect(result.valid).toBe(true);
  });

  it("accepts optional skillSequences", () => {
    const result = validateConfig({
      ...validConfig,
      skillSequences: { "brainstorming": ["writing-plans"] },
    });
    expect(result.valid).toBe(true);
  });

  it("accepts optional projectMarkers", () => {
    const result = validateConfig({
      ...validConfig,
      projectMarkers: [
        { file: "package.json", boosts: { dev: 1 } },
        { absent: ".git", penalties: { git: -2 } },
      ],
    });
    expect(result.valid).toBe(true);
  });

  it("rejects projectMarkers with neither file nor absent", () => {
    const result = validateConfig({
      ...validConfig,
      projectMarkers: [{ boosts: { dev: 1 } }],
    });
    expect(result.valid).toBe(false);
  });
});
```

**Step 2: Run tests to verify they fail**

Run: `npm test`
Expected: FAIL — `validateConfig` not found

**Step 3: Implement schema validation**

```js
// src/schema.js

const REQUIRED_RULE_FIELDS = ["id", "name", "category", "command", "enforcement", "keywords", "patterns", "description"];
const VALID_ENFORCEMENTS = ["suggest", "silent", "block"];

export function validateConfig(config) {
  const errors = [];

  if (!config || typeof config !== "object") {
    return { valid: false, errors: ["Config must be a JSON object"] };
  }

  if (config.version !== 2) {
    errors.push("Missing or invalid version (must be 2)");
  }

  if (!config.rules || !Array.isArray(config.rules)) {
    errors.push("Missing or invalid rules array");
    return { valid: false, errors };
  }

  // Validate rules
  const seenIds = new Set();
  for (let i = 0; i < config.rules.length; i++) {
    const rule = config.rules[i];
    const prefix = `rules[${i}]`;

    for (const field of REQUIRED_RULE_FIELDS) {
      if (rule[field] === undefined || rule[field] === null) {
        errors.push(`${prefix}: missing required field "${field}"`);
      }
    }

    if (rule.id) {
      if (seenIds.has(rule.id)) {
        errors.push(`${prefix}: duplicate rule ID "${rule.id}"`);
      }
      seenIds.add(rule.id);
    }

    if (rule.enforcement && !VALID_ENFORCEMENTS.includes(rule.enforcement)) {
      errors.push(`${prefix}: invalid enforcement "${rule.enforcement}" (must be suggest, silent, or block)`);
    }

    if (Array.isArray(rule.keywords) && rule.keywords.some((k) => typeof k !== "string")) {
      errors.push(`${prefix}: keywords must be an array of strings`);
    }

    if (Array.isArray(rule.patterns)) {
      for (let j = 0; j < rule.patterns.length; j++) {
        try {
          new RegExp(rule.patterns[j]);
        } catch {
          errors.push(`${prefix}: invalid regex pattern at index ${j}: "${rule.patterns[j]}"`);
        }
      }
    }
  }

  // Validate optional directorySignals
  if (config.directorySignals !== undefined) {
    if (!Array.isArray(config.directorySignals)) {
      errors.push("directorySignals must be an array");
    } else {
      for (let i = 0; i < config.directorySignals.length; i++) {
        const sig = config.directorySignals[i];
        if (!sig.pattern || typeof sig.pattern !== "string") {
          errors.push(`directorySignals[${i}]: missing or invalid pattern`);
        }
        if (!sig.boosts || typeof sig.boosts !== "object" || Array.isArray(sig.boosts)) {
          errors.push(`directorySignals[${i}]: missing or invalid boosts object`);
        }
      }
    }
  }

  // Validate optional fileTypeSignals
  if (config.fileTypeSignals !== undefined) {
    if (typeof config.fileTypeSignals !== "object" || Array.isArray(config.fileTypeSignals)) {
      errors.push("fileTypeSignals must be an object");
    }
  }

  // Validate optional skillSequences
  if (config.skillSequences !== undefined) {
    if (typeof config.skillSequences !== "object" || Array.isArray(config.skillSequences)) {
      errors.push("skillSequences must be an object");
    } else {
      for (const [key, val] of Object.entries(config.skillSequences)) {
        if (!Array.isArray(val)) {
          errors.push(`skillSequences["${key}"]: value must be an array of skill commands`);
        }
      }
    }
  }

  // Validate optional projectMarkers
  if (config.projectMarkers !== undefined) {
    if (!Array.isArray(config.projectMarkers)) {
      errors.push("projectMarkers must be an array");
    } else {
      for (let i = 0; i < config.projectMarkers.length; i++) {
        const marker = config.projectMarkers[i];
        if (!marker.file && !marker.absent) {
          errors.push(`projectMarkers[${i}]: must have either "file" or "absent" property`);
        }
      }
    }
  }

  return { valid: errors.length === 0, errors };
}
```

**Step 4: Run tests to verify they pass**

Run: `npm test`
Expected: All schema tests pass

**Step 5: Commit**

```bash
git add src/schema.js test/schema.test.js
git commit -m "feat: add schema validation for dispatch-rules.json"
```

---

### Task 3: Core Router Engine

**Files:**
- Create: `src/router.js`
- Create: `test/router.test.js`

**Step 1: Write failing tests for the router**

```js
// test/router.test.js
import { describe, it, expect } from "vitest";
import { scoreRule, layer1Match, applyContextSignals, route } from "../src/router.js";

const makeRule = (overrides = {}) => ({
  id: "test-rule",
  name: "Test Rule",
  category: "dev-workflows",
  command: "test:command",
  enforcement: "suggest",
  keywords: ["deploy", "release", "production"],
  patterns: ["\\bdeploy\\s+to\\b"],
  minMatches: 2,
  description: "Test rule",
  ...overrides,
});

describe("scoreRule", () => {
  it("scores keyword matches at +1 each", () => {
    const rule = makeRule();
    const result = scoreRule(rule, "deploy the release", "deploy the release");
    expect(result.score).toBe(2);
    expect(result.matchedTerms).toContain("deploy");
    expect(result.matchedTerms).toContain("release");
  });

  it("scores regex matches at +2 each", () => {
    const rule = makeRule();
    const result = scoreRule(rule, "deploy to production", "deploy to production");
    // "deploy" (+1) + "production" (+1) + /deploy\s+to/ (+2) = 4
    expect(result.score).toBe(4);
  });

  it("returns 0 for no matches", () => {
    const rule = makeRule();
    const result = scoreRule(rule, "hello world", "hello world");
    expect(result.score).toBe(0);
  });
});

describe("layer1Match", () => {
  const config = { maxMatches: 5, minScore: 2 };

  it("returns rules that meet threshold", () => {
    const rules = [makeRule()];
    const results = layer1Match(rules, config, "deploy the release");
    expect(results).toHaveLength(1);
    expect(results[0].id).toBe("test-rule");
    expect(results[0].layer).toBe(1);
  });

  it("excludes rules below threshold", () => {
    const rules = [makeRule({ minMatches: 5 })];
    const results = layer1Match(rules, config, "deploy something");
    expect(results).toHaveLength(0);
  });

  it("sorts by score descending", () => {
    const rules = [
      makeRule({ id: "low", keywords: ["test"], minMatches: 1 }),
      makeRule({ id: "high", keywords: ["deploy", "release", "ship", "production"], minMatches: 2 }),
    ];
    const results = layer1Match(rules, config, "deploy the release to production and ship it");
    expect(results[0].id).toBe("high");
  });
});

describe("applyContextSignals", () => {
  it("boosts matches by directory signals", () => {
    const matches = [{ id: "r1", category: "ui", score: 3, contextScore: 0, contextSignals: [], command: "x" }];
    const signals = {
      directorySignals: [{ pattern: "src/components", boosts: { ui: 2 } }],
    };
    const result = applyContextSignals(matches, "/project/src/components/Button", signals);
    expect(result[0].score).toBe(5);
    expect(result[0].contextSignals).toContain("dir:+2");
  });

  it("boosts matches by file type signals", () => {
    const matches = [{ id: "r1", category: "ui", score: 3, contextScore: 0, contextSignals: [], command: "x" }];
    const signals = { fileTypeSignals: { ".tsx": { ui: 1 } } };
    // We need to mock fs.readdirSync — test the signal application logic only
    // This test verifies the boost is applied when fileBoosts are provided
    const result = applyContextSignals(matches, "/tmp", signals, { fileBoosts: { ui: 1 } });
    expect(result[0].score).toBe(4);
  });

  it("applies skill sequence boosts", () => {
    const matches = [{ id: "r1", category: "dev", score: 2, contextScore: 0, contextSignals: [], command: "writing-plans" }];
    const signals = { skillSequences: { brainstorming: ["writing-plans"] } };
    const result = applyContextSignals(matches, "/tmp", signals, { sequenceBoosts: { "writing-plans": 2 } });
    expect(result[0].score).toBe(4);
    expect(result[0].contextSignals).toContain("seq:+2");
  });

  it("applies project marker penalties", () => {
    const matches = [{ id: "r1", category: "git-workflows", score: 3, contextScore: 0, contextSignals: [], command: "x" }];
    const signals = { projectMarkers: [{ absent: ".git", penalties: { "git-workflows": -2 } }] };
    const result = applyContextSignals(matches, "/tmp", signals, { markerBoosts: {}, markerPenalties: { "git-workflows": -2 } });
    expect(result[0].score).toBe(1);
  });
});

describe("route", () => {
  it("returns empty array for short prompts", () => {
    const config = { version: 2, config: { maxMatches: 5, minScore: 2 }, rules: [] };
    const result = route("hi", "/tmp", config);
    expect(result).toEqual([]);
  });

  it("returns empty array for slash commands", () => {
    const config = { version: 2, config: { maxMatches: 5, minScore: 2 }, rules: [makeRule()] };
    const result = route("/deploy to production now", "/tmp", config);
    expect(result).toEqual([]);
  });

  it("returns matches for valid prompts", () => {
    const config = { version: 2, config: { maxMatches: 5, minScore: 2 }, rules: [makeRule()] };
    const result = route("deploy the release to production", "/tmp", config);
    expect(result.length).toBeGreaterThan(0);
    expect(result[0].id).toBe("test-rule");
  });
});
```

**Step 2: Run tests to verify they fail**

Run: `npm test`
Expected: FAIL — imports not found

**Step 3: Implement the core router**

```js
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
```

**Step 4: Run tests to verify they pass**

Run: `npm test`
Expected: All router tests pass

**Step 5: Commit**

```bash
git add src/router.js test/router.test.js
git commit -m "feat: add core router engine with Layer 1 and Layer 1.5 scoring"
```

---

### Task 4: Starter Rules

**Files:**
- Create: `templates/starter-rules.json`

**Step 1: Create the 12 generic starter rules**

```json
{
  "version": 2,
  "config": {
    "maxMatches": 5,
    "minScore": 2,
    "cacheTTL": 300000,
    "llmFallback": false,
    "llmTimeout": 5000
  },
  "rules": [
    {
      "id": "tdd-workflow",
      "name": "Test-Driven Development",
      "category": "dev-workflows",
      "command": "tdd",
      "enforcement": "suggest",
      "keywords": ["test", "tdd", "failing test", "red green", "test first", "test driven"],
      "patterns": ["\\b(write|add|create)\\s+tests?\\s+(first|before)\\b", "\\btdd\\b"],
      "minMatches": 2,
      "description": "TDD workflow — write failing tests first, then implement"
    },
    {
      "id": "debugging",
      "name": "Systematic Debugging",
      "category": "dev-workflows",
      "command": "debug",
      "enforcement": "suggest",
      "keywords": ["bug", "error", "broken", "failing", "crash", "exception", "stack trace", "debug"],
      "patterns": ["\\b(fix|debug|investigate|diagnose)\\s+(this|the|a)\\b", "\\bnot\\s+working\\b"],
      "minMatches": 2,
      "description": "Systematic debugging with hypothesis-driven investigation"
    },
    {
      "id": "code-review",
      "name": "Code Review",
      "category": "code-quality",
      "command": "code-review",
      "enforcement": "suggest",
      "keywords": ["review", "PR", "pull request", "code review", "feedback", "check my code"],
      "patterns": ["\\breview\\s+(my|this|the)\\s+(code|changes|PR|pull request)\\b"],
      "minMatches": 2,
      "description": "Review code for quality, bugs, and best practices"
    },
    {
      "id": "commit-workflow",
      "name": "Git Commit",
      "category": "git-workflows",
      "command": "commit",
      "enforcement": "suggest",
      "keywords": ["commit", "push", "branch", "git", "stage", "staged"],
      "patterns": ["\\b(commit|push)\\s+(this|these|the|my)\\b", "\\bgit\\s+(commit|push|branch)\\b"],
      "minMatches": 2,
      "description": "Create git commits with conventional messages"
    },
    {
      "id": "refactoring",
      "name": "Code Refactoring",
      "category": "code-quality",
      "command": "refactor",
      "enforcement": "suggest",
      "keywords": ["refactor", "clean up", "simplify", "restructure", "extract", "DRY", "technical debt"],
      "patterns": ["\\b(refactor|clean\\s+up|simplify)\\s+(this|the|my)\\b"],
      "minMatches": 2,
      "description": "Refactor code for clarity, maintainability, and reduced complexity"
    },
    {
      "id": "documentation",
      "name": "Documentation",
      "category": "code-quality",
      "command": "docs",
      "enforcement": "suggest",
      "keywords": ["docs", "documentation", "readme", "document", "JSDoc", "docstring", "API docs"],
      "patterns": ["\\b(add|write|update|create)\\s+(docs|documentation|readme)\\b"],
      "minMatches": 2,
      "description": "Write or update documentation, READMEs, and API docs"
    },
    {
      "id": "deployment",
      "name": "Deployment",
      "category": "dev-workflows",
      "command": "deploy",
      "enforcement": "suggest",
      "keywords": ["deploy", "release", "ship", "CI/CD", "pipeline", "production", "staging"],
      "patterns": ["\\bdeploy\\s+to\\s+(production|staging|prod)\\b", "\\b(ship|release)\\s+(this|it)\\b"],
      "minMatches": 2,
      "description": "Deploy, release, or ship code to environments"
    },
    {
      "id": "security-audit",
      "name": "Security Audit",
      "category": "code-quality",
      "command": "security",
      "enforcement": "suggest",
      "keywords": ["security", "vulnerability", "audit", "CVE", "OWASP", "injection", "XSS", "secrets"],
      "patterns": ["\\b(security|vulnerability)\\s+(audit|scan|check|review)\\b"],
      "minMatches": 2,
      "description": "Audit code for security vulnerabilities and best practices"
    },
    {
      "id": "performance",
      "name": "Performance Optimization",
      "category": "dev-workflows",
      "command": "perf",
      "enforcement": "suggest",
      "keywords": ["slow", "optimize", "performance", "bottleneck", "latency", "memory leak", "profiling"],
      "patterns": ["\\b(too\\s+slow|optimize|speed\\s+up|performance\\s+issue)\\b"],
      "minMatches": 2,
      "description": "Investigate and fix performance bottlenecks"
    },
    {
      "id": "database",
      "name": "Database Operations",
      "category": "dev-workflows",
      "command": "database",
      "enforcement": "suggest",
      "keywords": ["schema", "migration", "query", "SQL", "database", "index", "table", "ORM"],
      "patterns": ["\\b(create|add|run)\\s+(a\\s+)?migration\\b", "\\b(database|schema)\\s+(design|change)\\b"],
      "minMatches": 2,
      "description": "Database schema design, migrations, and query optimization"
    },
    {
      "id": "api-design",
      "name": "API Design",
      "category": "dev-workflows",
      "command": "api",
      "enforcement": "suggest",
      "keywords": ["endpoint", "REST", "GraphQL", "API", "route", "controller", "handler"],
      "patterns": ["\\b(design|create|add)\\s+(an?\\s+)?(API|endpoint|route)\\b"],
      "minMatches": 2,
      "description": "Design and implement API endpoints"
    },
    {
      "id": "project-planning",
      "name": "Project Planning",
      "category": "project-management",
      "command": "plan",
      "enforcement": "suggest",
      "keywords": ["plan", "roadmap", "milestone", "architecture", "design", "scope", "requirements"],
      "patterns": ["\\b(plan|design|architect)\\s+(the|this|a|my)\\b", "\\b(roadmap|milestone)\\b"],
      "minMatches": 2,
      "description": "Plan project architecture, milestones, and implementation strategy"
    }
  ],
  "directorySignals": [],
  "fileTypeSignals": {},
  "skillSequences": {},
  "projectMarkers": [
    { "file": "package.json", "boosts": { "dev-workflows": 1 } },
    { "file": "pyproject.toml", "boosts": { "dev-workflows": 1 } },
    { "file": ".planning", "boosts": { "project-management": 2 } },
    { "absent": ".git", "penalties": { "git-workflows": -2 } }
  ]
}
```

**Step 2: Validate starter rules pass schema validation**

Create a quick test in `test/starter-rules.test.js`:

```js
import { describe, it, expect } from "vitest";
import { validateConfig } from "../src/schema.js";
import starterRules from "../templates/starter-rules.json" with { type: "json" };

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
```

Run: `npm test`
Expected: All pass

**Step 3: Commit**

```bash
git add templates/starter-rules.json test/starter-rules.test.js
git commit -m "feat: add 12 generic starter rules for init scaffolding"
```

---

### Task 5: Hook Template

**Files:**
- Create: `templates/hook.js`

This is the self-contained file copied into `.claude/hooks/` by `init`. It must work standalone with zero imports from `node_modules`.

**Step 1: Create the hook template**

```js
// templates/hook.js
// ---
// name: context-router
// description: Routes user prompts to matching skills via keyword/regex (Layer 1), context signals (Layer 1.5), and optional LLM fallback (Layer 2)
// event: UserPromptSubmit
// timeout: 10000
// ---
// Generated by claude-dispatch — https://github.com/lucaswadley/claude-dispatch
// "A router walks into a bar. The bartender says, 'We don't serve your type here.' The router replies, 'That's fine, I'll just redirect.'"

const { execFileSync } = require("child_process");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

// Config file path — looks for dispatch-rules.json next to .claude/hooks/
const RULES_PATH = path.join(__dirname, "..", "dispatch-rules.json");
const CACHE_PATH = path.join(__dirname, "..", ".dispatch-cache.json");
const HISTORY_PATH = path.join(__dirname, "..", ".dispatch-history.json");

function exit() {
  console.log(JSON.stringify({}));
  process.exit(0);
}

// --- Helpers ---

function readStdin() {
  try {
    const chunks = [];
    const buf = Buffer.alloc(65536);
    let bytesRead;
    while (true) {
      try {
        bytesRead = fs.readSync(0, buf, 0, buf.length);
        if (bytesRead === 0) break;
        chunks.push(buf.slice(0, bytesRead));
      } catch { break; }
    }
    return Buffer.concat(chunks).toString("utf8");
  } catch { return ""; }
}

function loadRules() {
  try {
    return JSON.parse(fs.readFileSync(RULES_PATH, "utf8"));
  } catch { return null; }
}

function hashPrompt(prompt, cwd) {
  return crypto.createHash("md5").update(prompt.slice(0, 200) + "|" + cwd).digest("hex");
}

function loadCache() {
  try { return JSON.parse(fs.readFileSync(CACHE_PATH, "utf8")); } catch { return {}; }
}

function saveCache(cache) {
  try { fs.writeFileSync(CACHE_PATH, JSON.stringify(cache), "utf8"); } catch {}
}

function pruneCache(cache, ttl) {
  const now = Date.now();
  const pruned = {};
  for (const [key, entry] of Object.entries(cache)) {
    if (now - entry.ts < ttl) pruned[key] = entry;
  }
  return pruned;
}

// --- Layer 1: Keyword/Regex Scoring ---

function scoreRule(rule, promptLower, promptRaw) {
  let score = 0;
  const matchedTerms = [];
  for (const kw of rule.keywords) {
    if (promptLower.includes(kw.toLowerCase())) { score += 1; matchedTerms.push(kw); }
  }
  for (const pat of rule.patterns) {
    try { if (new RegExp(pat, "i").test(promptRaw)) { score += 2; matchedTerms.push(`/${pat}/`); } } catch {}
  }
  return { score, matchedTerms };
}

function layer1Match(rules, config, prompt) {
  const promptLower = prompt.toLowerCase();
  const results = [];
  for (const rule of rules) {
    const { score, matchedTerms } = scoreRule(rule, promptLower, prompt);
    const threshold = rule.minMatches || config.minScore || 2;
    if (score >= threshold) {
      results.push({
        id: rule.id, name: rule.name, category: rule.category, command: rule.command,
        enforcement: rule.enforcement, description: rule.description,
        score, keywordScore: score, contextScore: 0, contextSignals: [], matchedTerms, layer: 1,
      });
    }
  }
  results.sort((a, b) => b.score - a.score);
  return results.slice(0, (config.maxMatches || 5) * 2);
}

// --- Layer 1.5: Context Signals ---

function detectDirectoryContext(cwd, directorySignals) {
  if (!directorySignals) return {};
  const boosts = {};
  for (const entry of directorySignals) {
    try {
      if (new RegExp(entry.pattern).test(cwd)) {
        for (const [cat, val] of Object.entries(entry.boosts)) { boosts[cat] = (boosts[cat] || 0) + val; }
      }
    } catch {}
  }
  return boosts;
}

function detectFileContext(cwd, fileTypeSignals) {
  if (!fileTypeSignals) return {};
  const boosts = {};
  try {
    const extCounts = {};
    for (const f of fs.readdirSync(cwd).slice(0, 50)) {
      const ext = path.extname(f).toLowerCase();
      if (ext) extCounts[ext] = (extCounts[ext] || 0) + 1;
    }
    for (const [ext, count] of Object.entries(extCounts)) {
      if (count >= 3 && fileTypeSignals[ext]) {
        for (const [cat, val] of Object.entries(fileTypeSignals[ext])) { boosts[cat] = (boosts[cat] || 0) + val; }
      }
    }
  } catch {}
  return boosts;
}

function detectProjectMarkers(cwd, projectMarkers) {
  if (!projectMarkers) return { boosts: {}, penalties: {} };
  const boosts = {};
  const penalties = {};
  const exists = (p) => { try { fs.accessSync(p); return true; } catch { return false; } };

  for (const marker of projectMarkers) {
    if (marker.file) {
      let found = false;
      let dir = cwd;
      for (let i = 0; i < 6; i++) {
        if (exists(path.join(dir, marker.file))) { found = true; break; }
        const parent = path.dirname(dir);
        if (parent === dir) break;
        dir = parent;
      }
      if (found && marker.boosts) {
        for (const [cat, val] of Object.entries(marker.boosts)) { boosts[cat] = (boosts[cat] || 0) + val; }
      }
    }
    if (marker.absent) {
      let found = false;
      let dir = cwd;
      for (let i = 0; i < 6; i++) {
        if (exists(path.join(dir, marker.absent))) { found = true; break; }
        const parent = path.dirname(dir);
        if (parent === dir) break;
        dir = parent;
      }
      if (!found && marker.penalties) {
        for (const [cat, val] of Object.entries(marker.penalties)) { penalties[cat] = (penalties[cat] || 0) + val; }
      }
    }
  }
  return { boosts, penalties };
}

function detectSessionSequence(skillSequences) {
  if (!skillSequences) return {};
  try {
    const hist = JSON.parse(fs.readFileSync(HISTORY_PATH, "utf8"));
    if (!hist.history || hist.history.length === 0) return {};
    const lastEntry = hist.history[hist.history.length - 1];
    if (Date.now() - lastEntry.ts > 2 * 60 * 60 * 1000) return {};
    const nextSkills = skillSequences[lastEntry.skill];
    if (!nextSkills) return {};
    const boosts = {};
    for (let i = 0; i < nextSkills.length; i++) { boosts[nextSkills[i]] = i === 0 ? 2 : 1; }
    return boosts;
  } catch { return {}; }
}

function applyContextSignals(matches, cwd, rulesConfig) {
  if (!matches || matches.length === 0) return matches;
  const dirBoosts = detectDirectoryContext(cwd, rulesConfig.directorySignals);
  const fileBoosts = detectFileContext(cwd, rulesConfig.fileTypeSignals);
  const { boosts: markerBoosts, penalties: markerPenalties } = detectProjectMarkers(cwd, rulesConfig.projectMarkers);
  const sequenceBoosts = detectSessionSequence(rulesConfig.skillSequences);

  for (const match of matches) {
    let ctxScore = 0;
    const signals = [];
    const cat = match.category;
    if (dirBoosts[cat]) { ctxScore += dirBoosts[cat]; signals.push(`dir:+${dirBoosts[cat]}`); }
    if (fileBoosts[cat]) { ctxScore += fileBoosts[cat]; signals.push(`files:+${fileBoosts[cat]}`); }
    if (markerBoosts[cat]) { ctxScore += markerBoosts[cat]; signals.push(`marker:+${markerBoosts[cat]}`); }
    if (markerPenalties[cat]) { ctxScore += markerPenalties[cat]; signals.push(`marker:${markerPenalties[cat]}`); }
    if (sequenceBoosts[match.command]) { ctxScore += sequenceBoosts[match.command]; signals.push(`seq:+${sequenceBoosts[match.command]}`); }
    match.contextScore = ctxScore;
    match.contextSignals = signals;
    match.score += ctxScore;
  }
  return matches;
}

// --- Layer 2: LLM Fallback ---

function layer2Match(rules, config, prompt) {
  const ruleList = rules.map((r) => `- ${r.id}: ${r.description}`).join("\n");
  const classifierPrompt =
    "You are a skill classifier. Given a user prompt, identify which skills (if any) are relevant. " +
    "Return ONLY a JSON array of matching skill IDs, or an empty array if none match.\n\n" +
    "Available skills:\n" + ruleList +
    "\n\nUser prompt: " + JSON.stringify(prompt.slice(0, 500)) +
    "\n\nReturn ONLY a JSON array like [\"skill-id-1\"] or []. No explanation.";

  try {
    const result = execFileSync("claude", ["--print", "-m", "haiku", "--max-tokens", "200"], {
      input: classifierPrompt, timeout: config.llmTimeout || 5000, encoding: "utf8", stdio: ["pipe", "pipe", "pipe"],
    });
    const match = result.match(/\[[\s\S]*?\]/);
    if (!match) return [];
    const ids = JSON.parse(match[0]);
    if (!Array.isArray(ids)) return [];
    const ruleMap = Object.fromEntries(rules.map((r) => [r.id, r]));
    return ids.filter((id) => ruleMap[id]).map((id) => {
      const rule = ruleMap[id];
      return {
        id: rule.id, name: rule.name, category: rule.category, command: rule.command,
        enforcement: rule.enforcement, description: rule.description,
        score: 0, keywordScore: 0, contextScore: 0, contextSignals: ["llm-classified"], matchedTerms: ["llm-classified"], layer: 2,
      };
    }).slice(0, config.maxMatches || 5);
  } catch { return []; }
}

// --- History ---

function recordTopMatch(command) {
  try {
    let hist;
    try { hist = JSON.parse(fs.readFileSync(HISTORY_PATH, "utf8")); } catch { hist = { history: [], pid: null }; }
    const pid = process.ppid || process.pid;
    if (hist.pid && hist.pid !== pid) { hist.history = []; }
    hist.pid = pid;
    hist.history.push({ skill: command, ts: Date.now() });
    if (hist.history.length > 10) { hist.history = hist.history.slice(-10); }
    fs.writeFileSync(HISTORY_PATH, JSON.stringify(hist), "utf8");
  } catch {}
}

// --- Output ---

function outputMatches(matches) {
  console.log(JSON.stringify({
    contextRouter: {
      matched: true,
      matchCount: matches.length,
      matches: matches.map((m) => ({
        id: m.id, name: m.name, command: m.command, enforcement: m.enforcement,
        description: m.description, score: m.score, keywordScore: m.keywordScore,
        contextScore: m.contextScore, contextSignals: m.contextSignals, layer: m.layer,
      })),
      instruction:
        "Present these matched skills to the user for confirmation before activating. " +
        "Only invoke Skill tool for skills the user explicitly approves. " +
        "If enforcement is 'block', require explicit acknowledgment. " +
        "If enforcement is 'silent', mention the skill without requiring action.",
    },
  }));
}

// --- Main ---

function main() {
  try {
    const input = readStdin();
    if (!input) return exit();
    let data;
    try { data = JSON.parse(input); } catch { return exit(); }

    const prompt = data.user_prompt || "";
    const cwd = data.cwd || process.cwd();
    if (!prompt || prompt.length < 10) return exit();
    if (prompt.startsWith("/")) return exit();

    const rulesFile = loadRules();
    if (!rulesFile || !rulesFile.rules) return exit();
    const { config, rules } = rulesFile;

    // Cache check
    const hash = hashPrompt(prompt, cwd);
    let cache = loadCache();
    cache = pruneCache(cache, config.cacheTTL || 300000);
    if (cache[hash]) {
      const cached = cache[hash].matches;
      if (cached.length > 0) { recordTopMatch(cached[0].command); outputMatches(cached); }
      return exit();
    }

    // Layer 1
    let matches = layer1Match(rules, config, prompt);

    // Layer 1.5
    if (matches.length > 0) {
      matches = applyContextSignals(matches, cwd, rulesFile);
      matches.sort((a, b) => b.score - a.score);
      matches = matches.slice(0, config.maxMatches || 5);
    }

    // Layer 2
    if (matches.length === 0 && config.llmFallback) {
      matches = layer2Match(rules, config, prompt);
    }

    if (matches.length > 0) { recordTopMatch(matches[0].command); }
    cache[hash] = { ts: Date.now(), matches };
    saveCache(cache);
    if (matches.length > 0) { outputMatches(matches); } else { exit(); }
  } catch { exit(); }
}

main();
```

**Step 2: Verify hook runs standalone**

Run: `echo '{"user_prompt":"deploy the release to production now","cwd":"/tmp"}' | node templates/hook.js`
Expected: JSON output with `contextRouter.matched: true` (assuming starter-rules.json is at the expected path — this test can be deferred to integration)

**Step 3: Commit**

```bash
git add templates/hook.js
git commit -m "feat: add self-contained hook template for init scaffolding"
```

---

### Task 6: CLI — Scaffold Command (init)

**Files:**
- Create: `src/scaffold.js`
- Create: `test/scaffold.test.js`

**Step 1: Write failing tests**

```js
// test/scaffold.test.js
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { scaffold } from "../src/scaffold.js";

describe("scaffold", () => {
  let tmpDir;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "dispatch-test-"));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("creates .claude/hooks/ directory structure", async () => {
    const result = await scaffold(tmpDir, {});
    expect(fs.existsSync(path.join(tmpDir, ".claude", "hooks"))).toBe(true);
    expect(result.hookCreated).toBe(true);
  });

  it("copies hook file to .claude/hooks/context-router.js", async () => {
    await scaffold(tmpDir, {});
    const hookPath = path.join(tmpDir, ".claude", "hooks", "context-router.js");
    expect(fs.existsSync(hookPath)).toBe(true);
    const content = fs.readFileSync(hookPath, "utf8");
    expect(content).toContain("contextRouter");
  });

  it("copies starter rules to .claude/dispatch-rules.json", async () => {
    await scaffold(tmpDir, {});
    const rulesPath = path.join(tmpDir, ".claude", "dispatch-rules.json");
    expect(fs.existsSync(rulesPath)).toBe(true);
    const config = JSON.parse(fs.readFileSync(rulesPath, "utf8"));
    expect(config.version).toBe(2);
    expect(config.rules.length).toBeGreaterThan(0);
  });

  it("does not overwrite existing rules file", async () => {
    const rulesPath = path.join(tmpDir, ".claude", "dispatch-rules.json");
    fs.mkdirSync(path.join(tmpDir, ".claude"), { recursive: true });
    fs.writeFileSync(rulesPath, '{"version":2,"custom":true}');
    await scaffold(tmpDir, {});
    const content = JSON.parse(fs.readFileSync(rulesPath, "utf8"));
    expect(content.custom).toBe(true);
  });

  it("overwrites rules with --force", async () => {
    const rulesPath = path.join(tmpDir, ".claude", "dispatch-rules.json");
    fs.mkdirSync(path.join(tmpDir, ".claude"), { recursive: true });
    fs.writeFileSync(rulesPath, '{"version":2,"custom":true}');
    await scaffold(tmpDir, { force: true });
    const content = JSON.parse(fs.readFileSync(rulesPath, "utf8"));
    expect(content.custom).toBeUndefined();
    expect(content.rules.length).toBeGreaterThan(0);
  });

  it("--update replaces hook but preserves rules", async () => {
    const rulesPath = path.join(tmpDir, ".claude", "dispatch-rules.json");
    const hookPath = path.join(tmpDir, ".claude", "hooks", "context-router.js");
    fs.mkdirSync(path.join(tmpDir, ".claude", "hooks"), { recursive: true });
    fs.writeFileSync(rulesPath, '{"version":2,"custom":true}');
    fs.writeFileSync(hookPath, "// old hook");
    await scaffold(tmpDir, { update: true });
    const hookContent = fs.readFileSync(hookPath, "utf8");
    expect(hookContent).toContain("contextRouter");
    const rulesContent = JSON.parse(fs.readFileSync(rulesPath, "utf8"));
    expect(rulesContent.custom).toBe(true);
  });
});
```

**Step 2: Run tests to verify they fail**

Run: `npm test`
Expected: FAIL

**Step 3: Implement scaffold**

```js
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
```

**Step 4: Run tests**

Run: `npm test`
Expected: All pass

**Step 5: Commit**

```bash
git add src/scaffold.js test/scaffold.test.js
git commit -m "feat: add scaffold command for init/update/force"
```

---

### Task 7: CLI — Validate Command

**Files:**
- Create: `src/validate.js`
- Create: `test/validate.test.js`

**Step 1: Write failing tests**

```js
// test/validate.test.js
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { validateFile } from "../src/validate.js";

describe("validateFile", () => {
  let tmpDir;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "dispatch-validate-"));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("returns valid for a correct config file", () => {
    const filePath = path.join(tmpDir, "rules.json");
    fs.writeFileSync(filePath, JSON.stringify({
      version: 2,
      config: { maxMatches: 5, minScore: 2 },
      rules: [{
        id: "test", name: "Test", category: "dev", command: "test",
        enforcement: "suggest", keywords: ["test"], patterns: [], description: "Test",
      }],
    }));
    const result = validateFile(filePath);
    expect(result.valid).toBe(true);
  });

  it("returns errors for invalid JSON", () => {
    const filePath = path.join(tmpDir, "rules.json");
    fs.writeFileSync(filePath, "not json {{{");
    const result = validateFile(filePath);
    expect(result.valid).toBe(false);
    expect(result.errors[0]).toMatch(/parse|json/i);
  });

  it("returns errors for missing file", () => {
    const result = validateFile(path.join(tmpDir, "nope.json"));
    expect(result.valid).toBe(false);
    expect(result.errors[0]).toMatch(/not found|read/i);
  });
});
```

**Step 2: Implement validate**

```js
// src/validate.js
import fs from "node:fs";
import { validateConfig } from "./schema.js";

export function validateFile(filePath) {
  let raw;
  try {
    raw = fs.readFileSync(filePath, "utf8");
  } catch {
    return { valid: false, errors: [`File not found or cannot be read: ${filePath}`] };
  }

  let config;
  try {
    config = JSON.parse(raw);
  } catch (e) {
    return { valid: false, errors: [`Failed to parse JSON: ${e.message}`] };
  }

  return validateConfig(config);
}
```

**Step 3: Run tests**

Run: `npm test`
Expected: All pass

**Step 4: Commit**

```bash
git add src/validate.js test/validate.test.js
git commit -m "feat: add validate command for config file checking"
```

---

### Task 8: CLI — Test Runner Command

**Files:**
- Create: `src/test-runner.js`
- Create: `test/test-runner.test.js`

**Step 1: Write failing tests**

```js
// test/test-runner.test.js
import { describe, it, expect } from "vitest";
import { dryRun, formatDryRun } from "../src/test-runner.js";

describe("dryRun", () => {
  const config = {
    version: 2,
    config: { maxMatches: 5, minScore: 2 },
    rules: [{
      id: "deploy", name: "Deployment", category: "dev-workflows", command: "deploy",
      enforcement: "suggest", keywords: ["deploy", "release", "production"],
      patterns: ["\\bdeploy\\s+to\\b"], description: "Deploy to environments",
    }],
  };

  it("returns matches for matching prompt", () => {
    const result = dryRun("deploy the release to production", "/tmp", config);
    expect(result.matches.length).toBeGreaterThan(0);
    expect(result.matches[0].id).toBe("deploy");
  });

  it("returns empty for non-matching prompt", () => {
    const result = dryRun("hello world how are you", "/tmp", config);
    expect(result.matches).toHaveLength(0);
  });
});

describe("formatDryRun", () => {
  it("formats matches into readable output", () => {
    const result = {
      matches: [{
        id: "deploy", name: "Deployment", command: "deploy", score: 4,
        keywordScore: 2, contextScore: 2, matchedTerms: ["deploy", "release"],
        contextSignals: ["marker:+2"], layer: 1,
      }],
    };
    const output = formatDryRun(result);
    expect(output).toContain("deploy");
    expect(output).toContain("Deployment");
    expect(output).toContain("score");
  });

  it("shows 'no matches' for empty results", () => {
    const output = formatDryRun({ matches: [] });
    expect(output).toMatch(/no match/i);
  });
});
```

**Step 2: Implement test runner**

```js
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
```

**Step 3: Run tests**

Run: `npm test`
Expected: All pass

**Step 4: Commit**

```bash
git add src/test-runner.js test/test-runner.test.js
git commit -m "feat: add test runner for dry-run prompt matching"
```

---

### Task 9: CLI — Add Rule Command

**Files:**
- Create: `src/rule-builder.js`
- Create: `test/rule-builder.test.js`

**Step 1: Write failing tests**

```js
// test/rule-builder.test.js
import { describe, it, expect } from "vitest";
import { buildRule, appendRule } from "../src/rule-builder.js";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";

describe("buildRule", () => {
  it("generates a rule object from answers", () => {
    const answers = {
      name: "My Custom Skill",
      category: "dev-workflows",
      command: "my-skill",
      keywords: "build, compile, make",
      patterns: "\\bbuild\\s+the\\b",
      enforcement: "suggest",
      minMatches: "2",
      description: "Build and compile projects",
    };
    const rule = buildRule(answers);
    expect(rule.id).toBe("my-custom-skill");
    expect(rule.name).toBe("My Custom Skill");
    expect(rule.keywords).toEqual(["build", "compile", "make"]);
    expect(rule.patterns).toEqual(["\\bbuild\\s+the\\b"]);
    expect(rule.minMatches).toBe(2);
  });

  it("generates kebab-case ID from name", () => {
    const rule = buildRule({
      name: "Some Complex  Skill Name!",
      category: "dev", command: "x", keywords: "a", patterns: "",
      enforcement: "suggest", minMatches: "2", description: "Test",
    });
    expect(rule.id).toBe("some-complex-skill-name");
  });
});

describe("appendRule", () => {
  it("appends a rule to an existing config file", () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "dispatch-rule-"));
    const filePath = path.join(tmpDir, "rules.json");
    fs.writeFileSync(filePath, JSON.stringify({
      version: 2, config: { maxMatches: 5, minScore: 2 }, rules: [],
    }));

    const rule = {
      id: "new-rule", name: "New Rule", category: "dev",
      command: "new", enforcement: "suggest", keywords: ["new"],
      patterns: [], description: "A new rule",
    };
    const result = appendRule(filePath, rule);
    expect(result.success).toBe(true);

    const config = JSON.parse(fs.readFileSync(filePath, "utf8"));
    expect(config.rules).toHaveLength(1);
    expect(config.rules[0].id).toBe("new-rule");

    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("rejects duplicate IDs", () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "dispatch-rule-"));
    const filePath = path.join(tmpDir, "rules.json");
    fs.writeFileSync(filePath, JSON.stringify({
      version: 2, config: { maxMatches: 5, minScore: 2 },
      rules: [{ id: "existing", name: "X", category: "dev", command: "x", enforcement: "suggest", keywords: ["x"], patterns: [], description: "X" }],
    }));

    const rule = { id: "existing", name: "Dupe", category: "dev", command: "x", enforcement: "suggest", keywords: ["x"], patterns: [], description: "X" };
    const result = appendRule(filePath, rule);
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/duplicate/i);

    fs.rmSync(tmpDir, { recursive: true, force: true });
  });
});
```

**Step 2: Implement rule builder**

```js
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
```

**Step 3: Run tests**

Run: `npm test`
Expected: All pass

**Step 4: Commit**

```bash
git add src/rule-builder.js test/rule-builder.test.js
git commit -m "feat: add rule builder for interactive add-rule command"
```

---

### Task 10: CLI Entry Point

**Files:**
- Create: `bin/cli.js`

**Step 1: Create the CLI entry point**

```js
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
```

**Step 2: Make cli.js executable**

Run: `chmod +x bin/cli.js`

**Step 3: Verify CLI runs**

Run: `node bin/cli.js --help`
Expected: Shows help with init, validate, test, add-rule commands

Run: `node bin/cli.js --version`
Expected: `0.1.0`

**Step 4: Commit**

```bash
git add bin/cli.js
git commit -m "feat: add CLI entry point with init, validate, test, add-rule commands"
```

---

### Task 11: README and Documentation

**Files:**
- Create: `README.md`
- Create: `LICENSE`

**Step 1: Create README**

The README should cover:
- What it is (one-paragraph description)
- Quick start (`npx claude-dispatch init`)
- Architecture diagram (text-based)
- JSON schema reference
- CLI commands reference
- How to add a skill to route
- How to tell Claude agents to add rules
- How to create a skill from scratch

**Step 2: Create MIT LICENSE**

Standard MIT license with Lucas Wadley as author.

**Step 3: Commit**

```bash
git add README.md LICENSE
git commit -m "docs: add README with architecture guide and skill integration docs"
```

---

### Task 12: Integration Test and Final Validation

**Files:**
- Create: `test/integration.test.js`

**Step 1: Write integration test**

```js
// test/integration.test.js
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";

const CLI = path.join(import.meta.dirname, "..", "bin", "cli.js");

describe("CLI integration", () => {
  let tmpDir;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "dispatch-int-"));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("init creates hook and config", () => {
    execFileSync("node", [CLI, "init"], { cwd: tmpDir });
    expect(fs.existsSync(path.join(tmpDir, ".claude", "hooks", "context-router.js"))).toBe(true);
    expect(fs.existsSync(path.join(tmpDir, ".claude", "dispatch-rules.json"))).toBe(true);
  });

  it("validate passes on init config", () => {
    execFileSync("node", [CLI, "init"], { cwd: tmpDir });
    const result = execFileSync("node", [CLI, "validate", "-f", path.join(tmpDir, ".claude", "dispatch-rules.json")], {
      cwd: tmpDir, encoding: "utf8",
    });
    expect(result).toContain("Valid");
  });

  it("test shows matches for matching prompt", () => {
    execFileSync("node", [CLI, "init"], { cwd: tmpDir });
    const result = execFileSync("node", [CLI, "test", "deploy the release to production now", "-f", path.join(tmpDir, ".claude", "dispatch-rules.json")], {
      cwd: tmpDir, encoding: "utf8",
    });
    expect(result).toContain("Deployment");
  });

  it("test shows no matches for unrelated prompt", () => {
    execFileSync("node", [CLI, "init"], { cwd: tmpDir });
    const result = execFileSync("node", [CLI, "test", "hello how are you today", "-f", path.join(tmpDir, ".claude", "dispatch-rules.json")], {
      cwd: tmpDir, encoding: "utf8",
    });
    expect(result).toMatch(/no match/i);
  });

  it("init --update preserves config", () => {
    execFileSync("node", [CLI, "init"], { cwd: tmpDir });
    const rulesPath = path.join(tmpDir, ".claude", "dispatch-rules.json");
    const config = JSON.parse(fs.readFileSync(rulesPath, "utf8"));
    config.custom = true;
    fs.writeFileSync(rulesPath, JSON.stringify(config));
    execFileSync("node", [CLI, "init", "--update"], { cwd: tmpDir });
    const updated = JSON.parse(fs.readFileSync(rulesPath, "utf8"));
    expect(updated.custom).toBe(true);
  });
});
```

**Step 2: Run all tests**

Run: `npm test`
Expected: All tests pass

**Step 3: Delete smoke test**

Remove `test/smoke.test.js` — no longer needed.

**Step 4: Final commit**

```bash
git rm test/smoke.test.js
git add test/integration.test.js
git commit -m "test: add integration tests and remove smoke test"
```

---

### Task 13: Ship to GitHub

**Step 1: Create GitHub repo**

Run: `gh repo create lucaswadley/claude-dispatch --public --source . --push`

**Step 2: Verify**

Run: `gh repo view lucaswadley/claude-dispatch`
Expected: Repository exists with all commits

---

## Parallel Agent Assignment (for team-feature)

The tasks group naturally into three workstreams:

| Agent | Tasks | Files |
|-------|-------|-------|
| **Agent 1: Core Engine** | 1, 2, 3, 6, 7, 8, 9, 10, 12 | `package.json`, `src/*`, `bin/cli.js`, `test/*` |
| **Agent 2: Templates** | 4, 5 | `templates/*`, `test/starter-rules.test.js` |
| **Agent 3: Docs** | 11 | `README.md`, `LICENSE` |

Agent 1 is the critical path. Agents 2 and 3 can run fully in parallel. Agent 1 depends on Agent 2 completing Task 5 (starter rules) before Task 6 (scaffold tests need starter-rules.json to exist).
