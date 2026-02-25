# claude-dispatch — Design Document

## Overview

Open-source context-aware skill router for Claude Code hooks. Distributed as an npm package, installed via `npx claude-dispatch init`.

Architecture: Layer 1 (keyword/regex) → Layer 1.5 (context signals) → Layer 2 (LLM fallback). All scoring is zero-token — runs in the Node.js hook process, not in Claude's context window.

## Distribution

- **npm package**: `npm install -g claude-dispatch` or `npx claude-dispatch init`
- **Self-contained hook**: `init` copies a standalone JS file into `.claude/hooks/` — no runtime dependency on `node_modules`
- **Config-only API**: users interact exclusively through `dispatch-rules.json`
- **Updates**: `npx claude-dispatch init --update` replaces hook file, never overwrites config

## Package Structure

```
claude-dispatch/
├── package.json
├── bin/
│   └── cli.js                # CLI entry (init, validate, test, add-rule)
├── src/
│   ├── router.js             # Core routing engine (L1 + L1.5 + L2)
│   ├── schema.js             # JSON schema validation
│   ├── scaffold.js           # init command
│   ├── test-runner.js        # test command — dry-run matching
│   └── rule-builder.js       # add-rule command — interactive rule creation
├── templates/
│   ├── hook.js               # Self-contained hook (built from src/router.js)
│   └── starter-rules.json    # ~12 generic example rules
├── test/
│   ├── router.test.js
│   ├── schema.test.js
│   └── fixtures/
└── README.md
```

## JSON Schema (dispatch-rules.json)

Single config file with all routing configuration:

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
      "command": "superpowers:test-driven-development",
      "enforcement": "suggest",
      "keywords": ["test", "tdd", "failing test", "red green refactor"],
      "patterns": ["\\b(write|add)\\s+tests?\\s+(first|before)\\b"],
      "minMatches": 2,
      "description": "TDD workflow with red-green-refactor cycle"
    }
  ],
  "directorySignals": [
    {
      "pattern": "src/components",
      "boosts": { "ui": 2, "dev-workflows": 1 }
    }
  ],
  "fileTypeSignals": {
    ".tsx": { "ui": 2, "dev-workflows": 1 },
    ".py": { "data-science": 1 }
  },
  "skillSequences": {
    "brainstorming": ["writing-plans"],
    "writing-plans": ["executing-plans"]
  },
  "projectMarkers": [
    { "file": "package.json", "boosts": { "dev-workflows": 1 } },
    { "file": ".planning", "boosts": { "project-management": 2 } },
    { "absent": ".git", "penalties": { "git-workflows": -2 } }
  ]
}
```

### Rule Fields

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `id` | string | yes | Unique kebab-case identifier |
| `name` | string | yes | Human-readable name |
| `category` | string | yes | Grouping for context signal boosts |
| `command` | string | yes | Skill command to invoke |
| `enforcement` | string | yes | `"suggest"`, `"silent"`, or `"block"` |
| `keywords` | string[] | yes | Substring matches (+1 each) |
| `patterns` | string[] | yes | Regex matches (+2 each) |
| `minMatches` | number | no | Override global `minScore` for this rule |
| `description` | string | yes | Shown to user when matched |

### Enforcement Levels

- **suggest**: Present to user for confirmation before activating
- **silent**: Mention the skill without requiring action
- **block**: Require explicit acknowledgment before proceeding

## CLI Commands

### `npx claude-dispatch init`

- Creates `.claude/hooks/` if needed
- Copies hook → `.claude/hooks/context-router.js`
- Copies starter rules → `.claude/dispatch-rules.json` (skips if exists)
- `--update`: replaces hook only, preserves config
- `--force`: overwrites everything (with confirmation)

### `npx claude-dispatch validate`

- Parses config against schema
- Checks: valid JSON, required fields, regex compilation, no duplicate IDs, category consistency
- Exit code 0/1 for CI

### `npx claude-dispatch test "<prompt>"`

- Dry-runs prompt through all layers
- Shows keyword matches, context signal boosts, final ranking
- Uses current working directory for context signals

### `npx claude-dispatch add-rule`

- Interactive prompts: name → ID (auto-generated) → category → command → keywords → patterns → enforcement → minMatches
- Appends to config, runs validate automatically

## Hook I/O Contract

### Input (stdin)

```json
{ "user_prompt": "...", "cwd": "/path/to/project" }
```

### Output (stdout)

No match:
```json
{}
```

Match found:
```json
{
  "contextRouter": {
    "matched": true,
    "matchCount": 2,
    "matches": [
      {
        "id": "tdd-workflow",
        "name": "Test-Driven Development",
        "command": "superpowers:test-driven-development",
        "enforcement": "suggest",
        "description": "...",
        "score": 4,
        "keywordScore": 3,
        "contextScore": 1,
        "contextSignals": ["marker:+1"],
        "layer": 1
      }
    ],
    "instruction": "Present these matched skills to the user for confirmation before activating."
  }
}
```

### Router Behavior

1. Skip prompts < 10 chars or starting with `/`
2. Layer 1: score all rules — keywords (+1 each), regex patterns (+2 each)
3. Layer 1.5: apply context signals (directory, file types, project markers, skill sequences) to Layer 1 results
4. Layer 2: if L1+L1.5 found nothing and `llmFallback: true`, call `claude --print -m haiku`
5. Cache by prompt+cwd hash, TTL from config
6. Track top match in session history for sequence detection

## Starter Rules Pack

12 generic developer workflow rules shipped with `init`:

| ID | Category | Triggers on |
|----|----------|-------------|
| `tdd-workflow` | dev-workflows | "write tests first" |
| `debugging` | dev-workflows | "this function is broken" |
| `code-review` | code-quality | "review my changes" |
| `commit-workflow` | git-workflows | "commit and push this" |
| `refactoring` | code-quality | "refactor this module" |
| `documentation` | code-quality | "add documentation" |
| `deployment` | dev-workflows | "deploy to production" |
| `security-audit` | code-quality | "check for vulnerabilities" |
| `performance` | dev-workflows | "this endpoint is slow" |
| `database` | dev-workflows | "add a migration" |
| `api-design` | dev-workflows | "design the API" |
| `project-planning` | project-management | "plan the next phase" |

## Documentation — Skill Integration Guide

### How to add a skill to route (for humans)

1. Create your skill file (`.claude/commands/my-skill.md` or plugin skill)
2. Run `npx claude-dispatch add-rule` to create the routing rule
3. Run `npx claude-dispatch test "a prompt that should trigger it"` to verify
4. Manual alternative: edit `dispatch-rules.json` directly following the schema

### How to tell another Claude agent to add a rule

Paste into your `CLAUDE.md`:

```markdown
## Adding dispatch rules
When creating a new skill, also add a routing rule to `.claude/dispatch-rules.json`.
Rule schema: { id, name, category, command, enforcement, keywords, patterns, minMatches, description }.
Run `npx claude-dispatch validate` after editing to confirm.
```

### How to create a skill from scratch

1. Create a markdown file in `.claude/commands/my-skill.md`
2. Add frontmatter: `name`, `description`
3. Write the skill instructions in the body
4. Wire to dispatch: run `npx claude-dispatch add-rule`
5. Test: `npx claude-dispatch test "prompt that should match"`

## Future Considerations (not v1)

- `migrate` command for schema version upgrades
- `stats` command for match history analysis
- `--mode linked` option for `require()`-based hook (no copy)
- Rule marketplace / community rule packs
