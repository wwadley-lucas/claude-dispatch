# claude-dispatch

Context-aware skill router for Claude Code hooks.

<!-- Badges: uncomment when published -->
<!-- [![npm version](https://img.shields.io/npm/v/claude-dispatch.svg)](https://www.npmjs.com/package/claude-dispatch) -->
<!-- [![license](https://img.shields.io/npm/l/claude-dispatch.svg)](LICENSE) -->

---

## What it does

claude-dispatch is a routing engine that automatically matches user prompts to relevant skills (custom commands, agents, workflows) in Claude Code. It installs as a [Claude Code hook](https://docs.anthropic.com/en/docs/claude-code/hooks) and intercepts every prompt to check whether a specialized skill should handle it, presenting matches to the user before activation.

The router reads a single config file (`dispatch-rules.json`) that defines your skills, their trigger keywords, regex patterns, and contextual signals like directory paths, file types, and project markers. When a prompt comes in, the router scores it against all rules and returns the top matches with enforcement levels (suggest, silent, or block).

All routing happens in a Node.js hook process outside of Claude's context window. This means **zero token cost** -- the router never consumes Claude tokens for matching. It only adds context to the conversation when a match is found, and even then it is a small structured payload rather than a full skill definition.

## Architecture

```
User Prompt
    |
    v
+----------------------------+
| Layer 1: Keyword + Regex   |  keywords: +1 each
|                            |  regex patterns: +2 each
+----------------------------+
    |
    v
+----------------------------+
| Layer 1.5: Context Signals |  directory path boosts
|                            |  file type detection
|                            |  project markers (file presence/absence)
|                            |  skill sequence history
+----------------------------+
    |
    v (only if L1+L1.5 found nothing and llmFallback: true)
+----------------------------+
| Layer 2: LLM Fallback      |  claude --print -m haiku
|                            |  (optional, disabled by default)
+----------------------------+
    |
    v
Matched skills returned to Claude Code
with enforcement level and instructions
```

**Layer 1** runs keyword substring matching (+1 per hit) and regex pattern matching (+2 per hit) against the raw prompt text. This is fast string/regex work in Node.js.

**Layer 1.5** takes the Layer 1 results and applies contextual boosts or penalties based on the current working directory, file types present in the directory, project marker files (like `package.json` or `.git`), and skill sequence history (what skill ran last in this session). These signals adjust scores up or down by category.

**Layer 2** is an optional LLM fallback (disabled by default). If Layers 1 and 1.5 found no matches and `llmFallback` is enabled, the router calls `claude --print -m haiku` with the prompt and rule list for a lightweight classification pass.

All three layers run in the hook process. Layers 1 and 1.5 consume zero Claude tokens. Layer 2 uses a small Haiku call only when enabled and only when the first two layers found nothing.

## Quick Start

```bash
npx claude-dispatch init
```

This creates two files in your project:

```
.claude/hooks/context-router.js   # The hook (self-contained, no node_modules needed)
.claude/dispatch-rules.json       # Your routing config (12 starter rules included)
```

Verify it works:

```bash
npx claude-dispatch test "deploy to production"
```

Expected output:

```
Testing prompt: "deploy to production"
Working directory: /your/project

Matches (2):
  1. deployment (score: 5, layer: 1)
     Command: deploy
     Enforcement: suggest
     Keywords: deploy, production
     Patterns: /\bdeploy\s+to\s+(production|staging|prod)\b/
     Context signals: (none)

  2. commit-workflow (score: 2, layer: 1)
     Command: commit
     Enforcement: suggest
     Keywords: push
     Context signals: (none)
```

Then tell Claude Code to use the hook by adding to your project's `.claude/settings.json`:

```json
{
  "hooks": {
    "PreToolUse": [
      {
        "matcher": "UserMessage",
        "command": "node .claude/hooks/context-router.js"
      }
    ]
  }
}
```

The `init` command handles this automatically if a `.claude/settings.json` already exists.

## CLI Commands

### `init`

Scaffold the hook and config into your project.

```bash
npx claude-dispatch init
```

Creates `.claude/hooks/context-router.js` and `.claude/dispatch-rules.json` (with 12 starter rules). Skips config creation if the file already exists.

Flags:

| Flag | Description |
|------|-------------|
| `--update` | Replace the hook file only. Preserves your `dispatch-rules.json`. Use this to upgrade the router after updating the npm package. |
| `--force` | Overwrite everything, including config. Prompts for confirmation before replacing an existing `dispatch-rules.json`. |

```bash
# Upgrade hook without touching config
npx claude-dispatch init --update

# Full reset (will prompt before overwriting config)
npx claude-dispatch init --force
```

### `validate`

Check your `dispatch-rules.json` for errors.

```bash
npx claude-dispatch validate
```

Checks performed:
- Valid JSON syntax
- Schema version is 2
- All required rule fields present (`id`, `name`, `category`, `command`, `enforcement`, `keywords`, `patterns`, `description`)
- No duplicate rule IDs
- All regex patterns compile without errors
- Valid enforcement values (`suggest`, `silent`, `block`)
- Optional sections (`directorySignals`, `fileTypeSignals`, `skillSequences`, `projectMarkers`) follow their schemas

Exits with code 0 on success, 1 on failure. Suitable for CI pipelines.

Flags:

| Flag | Description |
|------|-------------|
| `-f <path>` | Validate a config file at a custom path instead of `.claude/dispatch-rules.json`. |

```bash
# Validate default location
npx claude-dispatch validate

# Validate a specific file
npx claude-dispatch validate -f ./my-rules.json
```

### `test`

Dry-run a prompt through the router and see what matches.

```bash
npx claude-dispatch test "write tests before implementing the feature"
```

Shows keyword hits, regex matches, context signal boosts, and the final ranked list. Uses your current working directory for context signal evaluation (directory signals, file types, project markers).

Flags:

| Flag | Description |
|------|-------------|
| `-f <path>` | Use a config file at a custom path. |

```bash
npx claude-dispatch test "refactor this module to reduce complexity"
npx claude-dispatch test -f ./custom-rules.json "check for security vulnerabilities"
```

Example output:

```
Testing prompt: "write tests before implementing the feature"
Working directory: /home/user/my-project

Matches (1):
  1. tdd-workflow (score: 4, layer: 1)
     Command: tdd
     Enforcement: suggest
     Keywords: test, test first
     Patterns: /\b(write|add|create)\s+tests?\s+(first|before)\b/
     Context signals: marker:+1
```

### `add-rule`

Interactively create a new routing rule.

```bash
npx claude-dispatch add-rule
```

Walks you through each field:

```
? Rule name: My Custom Workflow
  Auto-generated ID: my-custom-workflow
? Category: dev-workflows
? Command to invoke: my-workflow
? Keywords (comma-separated): build, compile, make, webpack
? Regex patterns (one per line, blank to finish):
  > \bbuild\s+(this|the)\b
  >
? Enforcement level: suggest
? Minimum score override (blank for global default):

Rule added to .claude/dispatch-rules.json
Running validation... OK
```

The rule is appended to your config and validated automatically.

### `create`

Create a new skill or agent file **and** its routing rule in one step.

```bash
npx claude-dispatch create
```

The wizard walks you through the full flow:

```
? What are you creating? skill
? Name: Deploy Helper
? Description: Guides deployment to staging and production
? Category: dev-workflows
? Skill command: deploy-helper
? Keywords: deploy, staging, production, release
? Regex patterns (optional): \bdeploy\s+to\b
? Enforcement: suggest
? Min score: 2

Write to .claude/commands/deploy-helper.md? (Y/n) Y

  Created: .claude/commands/deploy-helper.md
  Rule added: "deploy-helper" → .claude/dispatch-rules.json
  Validation: passed

  Auto-test: "deploy staging production release"
  ✓ deploy-helper matched
```

Creates the markdown file (`.claude/commands/` for skills, `.claude/agents/` for agents), adds the routing rule, validates the config, and auto-tests that the new rule matches.

## Configuration Reference

All routing configuration lives in a single file: `.claude/dispatch-rules.json`.

### Full Schema

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

### `config` section

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `maxMatches` | number | `5` | Maximum number of matched skills returned per prompt. |
| `minScore` | number | `2` | Global minimum score threshold. Rules below this are excluded. |
| `cacheTTL` | number | `300000` | Cache time-to-live in milliseconds (5 minutes default). Repeated identical prompts in the same directory hit cache. |
| `llmFallback` | boolean | `false` | Enable Layer 2 LLM fallback when Layers 1+1.5 find nothing. |
| `llmTimeout` | number | `5000` | Timeout in milliseconds for Layer 2 LLM calls. |

### `rules` array

Each rule object:

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `id` | string | yes | Unique kebab-case identifier (e.g., `"tdd-workflow"`). |
| `name` | string | yes | Human-readable display name. |
| `category` | string | yes | Grouping key for context signal boosts (e.g., `"dev-workflows"`, `"code-quality"`). |
| `command` | string | yes | The skill command to invoke. Can be a custom command name (`"tdd"`), a namespaced skill (`"superpowers:test-driven-development"`), or any string your skill system recognizes. |
| `enforcement` | string | yes | One of `"suggest"`, `"silent"`, or `"block"`. See [Enforcement Levels](#enforcement-levels). |
| `keywords` | string[] | yes | Substring matches against the lowercased prompt. Each hit adds +1 to the score. |
| `patterns` | string[] | yes | Regular expressions tested against the raw prompt. Each hit adds +2 to the score. Use double-escaped backslashes in JSON (`"\\b"` for `\b`). |
| `minMatches` | number | no | Override the global `minScore` for this specific rule. If set, this rule uses its own threshold instead of `config.minScore`. |
| `description` | string | yes | Shown to the user when this rule matches. Keep it concise. |

### Enforcement Levels

| Level | Behavior |
|-------|----------|
| `suggest` | Present to the user for confirmation before activating the skill. |
| `silent` | Mention the skill in context without requiring user action. |
| `block` | Require explicit acknowledgment from the user before proceeding. |

### `directorySignals` (optional)

An array of directory pattern matchers. When the user's current working directory matches the pattern (tested as a regex), the specified categories receive score boosts.

```json
{
  "pattern": "src/components",
  "boosts": { "ui": 2, "dev-workflows": 1 }
}
```

If the user is working in `/project/src/components/Button/`, any rule in the `"ui"` category gets +2 and any rule in `"dev-workflows"` gets +1.

### `fileTypeSignals` (optional)

An object mapping file extensions to category boosts. The router reads the current directory (up to 50 files) and counts extensions. If 3 or more files share an extension, the associated boosts are applied.

```json
{
  ".tsx": { "ui": 2 },
  ".py": { "data-science": 1 }
}
```

A directory full of `.tsx` files boosts `"ui"` rules by +2.

### `skillSequences` (optional)

An object mapping skill commands to arrays of "next likely" skill commands. If the user recently ran a skill (within 2 hours), rules matching the next-in-sequence skills get a boost (+2 for the first item, +1 for subsequent).

```json
{
  "brainstorming": ["writing-plans"],
  "writing-plans": ["executing-plans"]
}
```

After a user runs a brainstorming skill, prompts that match `"writing-plans"` get a +2 sequence boost.

Session history is tracked per-process in a JSON file and resets when the Claude Code session changes.

### `projectMarkers` (optional)

An array of file-existence checks. The router looks for marker files starting from the current directory and walking up to 5 parent directories.

```json
[
  { "file": "package.json", "boosts": { "dev-workflows": 1 } },
  { "absent": ".git", "penalties": { "git-workflows": -2 } }
]
```

Each marker has either:
- `file` + `boosts`: if the file exists, apply boosts.
- `absent` + `penalties`: if the file does NOT exist, apply penalties.

## Scoring

The router computes a score for each rule against the incoming prompt:

```
final_score = keyword_score + pattern_score + context_score
```

1. **Keyword score**: For each keyword in the rule's `keywords` array, if it appears as a substring in the lowercased prompt, add +1.

2. **Pattern score**: For each regex in the rule's `patterns` array, if it matches the raw prompt (case-insensitive), add +2.

3. **Context score**: Sum of all applicable context signal boosts and penalties for the rule's category:
   - Directory signals: boost if cwd matches the pattern.
   - File type signals: boost if the directory contains 3+ files of the matching extension.
   - Project markers: boost if a marker file exists, penalize if an expected file is absent.
   - Skill sequences: boost if the last skill used suggests this skill as a follow-up.

A rule is included in the results if its `final_score >= minMatches` (rule-level override) or `final_score >= config.minScore` (global default of 2).

Results are sorted by score descending, capped at `config.maxMatches` (default 5).

### Scoring Example

Given a rule:
```json
{
  "id": "deployment",
  "keywords": ["deploy", "release", "production"],
  "patterns": ["\\bdeploy\\s+to\\s+(production|staging)\\b"],
  "category": "dev-workflows",
  "minMatches": 2
}
```

And a prompt: `"deploy to production please"`

```
Keyword "deploy"      -> found -> +1
Keyword "release"     -> not found
Keyword "production"  -> found -> +1
Pattern deploy\s+to   -> found -> +2
                                  ---
Keyword score: 2
Pattern score: 2
Context score: 0 (no matching signals)
Final score:   4   (>= minMatches of 2 -> MATCH)
```

### Caching

The router caches results by a hash of `prompt (first 200 chars) + cwd`. Cached results expire after `config.cacheTTL` milliseconds (default: 5 minutes). This avoids redundant scoring when the same prompt appears multiple times in quick succession.

### Skip conditions

The router returns no matches (short-circuits) when:
- The prompt is shorter than 10 characters.
- The prompt starts with `/` (it is already a direct skill invocation).

## Hook I/O

The hook reads from stdin and writes to stdout, following the Claude Code hooks contract.

**Input** (stdin):
```json
{ "user_prompt": "deploy to production", "cwd": "/path/to/project" }
```

**Output when no match** (stdout):
```json
{}
```

**Output when matched** (stdout):
```json
{
  "contextRouter": {
    "matched": true,
    "matchCount": 2,
    "matches": [
      {
        "id": "deployment",
        "name": "Deployment",
        "command": "deploy",
        "enforcement": "suggest",
        "description": "Deploy, release, or ship code to environments",
        "score": 5,
        "keywordScore": 4,
        "contextScore": 1,
        "contextSignals": ["marker:+1"],
        "layer": 1
      }
    ],
    "instruction": "Present these matched skills to the user for confirmation before activating."
  }
}
```

## How to add a skill to route

If you already have a skill (a `.claude/commands/*.md` file or a plugin skill) and want the router to detect when it should be used:

1. **Decide on keywords and patterns.** Think about what a user would say when they want this skill. Pick 3-6 keywords (common words in relevant prompts) and 1-2 regex patterns (more specific phrase structures).

2. **Run the interactive rule builder:**
   ```bash
   npx claude-dispatch add-rule
   ```

3. **Test it:**
   ```bash
   npx claude-dispatch test "a prompt that should trigger your skill"
   ```

4. **Iterate.** If the skill does not match, add more keywords or loosen the regex. If it matches too aggressively, raise `minMatches` or make patterns more specific. Run `test` again to verify.

**Manual alternative:** Edit `.claude/dispatch-rules.json` directly. Add a new object to the `rules` array following the schema, then run `npx claude-dispatch validate` to check for errors.

## How to tell Claude agents to add rules

If you use Claude Code agents or automated workflows that create new skills, you can instruct them to also wire up routing rules. Add this to your project's `CLAUDE.md`:

```markdown
## Dispatch Rules

When creating a new skill or command file in `.claude/commands/`, also add a routing
rule to `.claude/dispatch-rules.json` so the skill router can detect when users need it.

Rule schema (append to the `rules` array):
```json
{
  "id": "kebab-case-id",
  "name": "Human Readable Name",
  "category": "category-name",
  "command": "skill-command-name",
  "enforcement": "suggest",
  "keywords": ["keyword1", "keyword2", "keyword3"],
  "patterns": ["\\bregex\\s+pattern\\b"],
  "description": "One-line description of what the skill does"
}
```

After editing, run `npx claude-dispatch validate` to confirm the config is valid.
```

This lets agents self-register their skills with the router without manual intervention.

## How to create a skill from scratch

A complete skill has two parts: the skill file itself and a dispatch rule to route to it.

### 1. Create the skill file

```bash
mkdir -p .claude/commands
```

Create `.claude/commands/my-skill.md`:

```markdown
---
name: my-skill
description: What this skill does in one line
---

# My Skill

Instructions for Claude when this skill is invoked.

## Steps
1. First, do this.
2. Then do that.
3. Finally, verify the result.
```

### 2. Wire it to the router

```bash
npx claude-dispatch add-rule
```

Or manually add to `.claude/dispatch-rules.json`:

```json
{
  "id": "my-skill",
  "name": "My Skill",
  "category": "dev-workflows",
  "command": "my-skill",
  "enforcement": "suggest",
  "keywords": ["relevant", "trigger", "words"],
  "patterns": ["\\brelevant\\s+phrase\\b"],
  "minMatches": 2,
  "description": "One-line description shown when matched"
}
```

### 3. Test it

```bash
npx claude-dispatch validate
npx claude-dispatch test "a prompt containing relevant trigger words"
```

### 4. Use it

The next time a user sends a prompt that matches your keywords/patterns, the router will suggest the skill automatically.

## Contributing

Contributions are welcome. Please follow these guidelines:

1. **Fork and branch.** Create a feature branch from `main`.
2. **Write tests.** New features need tests. Run the test suite with `npm test`.
3. **Follow existing patterns.** Match the code style, naming conventions, and file organization already in the project.
4. **Keep changes focused.** One feature or fix per pull request.
5. **Validate your rules.** If you modify `templates/starter-rules.json`, run `npx claude-dispatch validate -f templates/starter-rules.json`.

### Development setup

```bash
git clone https://github.com/lucaswadley/claude-dispatch.git
cd claude-dispatch
npm install
npm test
```

### Running tests

```bash
# Run all tests
npm test

# Run tests in watch mode
npm run test:watch
```

## License

[MIT](LICENSE)
