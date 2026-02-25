# `create` Command — Design Document

## Overview

Unified wizard command (`npx claude-dispatch create`) that creates a Claude Code skill or agent file, adds the routing rule to dispatch-rules.json, and auto-tests the wiring.

## Flow

1. Select type: skill or agent
2. Collect metadata: name, description, category, command, keywords, patterns, enforcement, minMatches
3. Confirm output path (convention default with Y/n)
4. Create markdown file with minimal frontmatter
5. Add routing rule via existing buildRule/appendRule
6. Auto-validate config
7. Auto-test with generated prompt from keywords

## File Locations

- Skills: `.claude/commands/<name>.md`
- Agents: `.claude/agents/<name>.md`
- Convention defaults shown for confirmation, not customizable path

## Generated File Template

```markdown
---
name: <name>
description: <description>
---

<!-- Add your instructions here -->
```

## Implementation

- New: `src/creator.js` — createWizard(), generateTestPrompt()
- Modify: `bin/cli.js` — add create command
- New: `test/creator.test.js`
- Reuses: buildRule, appendRule from rule-builder.js
- Reuses: validateFile from validate.js
- Reuses: dryRun, formatDryRun from test-runner.js

## Auto-Test

Constructs a test prompt by joining the first 4 keywords. Runs dryRun() and formats output showing whether the new rule matched.
