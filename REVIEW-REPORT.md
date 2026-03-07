# claude-dispatch v0.1.1 — Consolidated Review Report

**Date**: 2026-03-07
**Method**: 5-agent parallel review (security, bugs, artifacts, quality, tests/docs)
**Scope**: All source files, templates, tests, and documentation
**Verdict**: Safe for npm publish (no credentials/PII leaks). Actionable bugs and quality issues identified.

---

## Executive Summary

| Severity | Count | Breakdown |
|----------|-------|-----------|
| CRITICAL | 0 | — |
| HIGH | 4 | 4 bugs |
| MEDIUM | 16 | 5 security, 7 bugs, 4 quality |
| LOW | 14 | 5 security, 5 bugs, 2 quality, 2 docs |
| INFO | 6 | 1 security, 2 quality, 1 docs, 2 artifacts |

**Personal artifacts**: **CLEAN** — no credentials, hardcoded paths, or PII in shipped files.
**Test count**: 71 (README badge says 61 — stale).
**Documentation accuracy**: 5/10 — multiple factual inaccuracies in README.
**Estimated test coverage**: ~55-60% of code paths; `templates/hook.js` has 0%.

---

## TIER 1: Fix Before Next Release (HIGH severity)

### H1: Non-Array `keywords`/`patterns` Causes Character Iteration
- **Source**: Bug Hunter
- **Files**: `src/schema.js:64-66`, `src/router.js:24-29`
- **Impact**: A config typo (`"keywords": "test,debug"` instead of `["test","debug"]`) passes validation and silently breaks all routing — the string is iterated character-by-character, matching every prompt.
- **Fix**: Add type validation in `validateConfig()`:
  ```js
  if (rule.keywords !== undefined && !Array.isArray(rule.keywords))
    errors.push(`${prefix}: keywords must be an array`);
  ```
  Add defensive guard in `scoreRule()`:
  ```js
  if (!Array.isArray(rule.keywords)) return { score: 0, matchedTerms: [] };
  ```

### H2: Keyword Substring Matching Causes False Positives
- **Source**: Bug Hunter
- **Files**: `src/router.js:24-29`, `templates/hook.js:88-89`
- **Impact**: `promptLower.includes(kw)` matches substrings: "test" matches "contest", "bug" matches "debugging". Rules with `enforcement: "block"` could incorrectly block prompts.
- **Fix**: Use word-boundary regex: `new RegExp("\\b" + escapeRegex(kw) + "\\b", "i").test(prompt)`, or document as intentional and recommend `patterns` for precision.

### H3: Hash Collision via Delimiter Ambiguity in Cache Key
- **Source**: Bug Hunter
- **Files**: `src/router.js:273-278`, `templates/hook.js:58-60`
- **Impact**: `md5(prompt + "|" + cwd)` collides when prompt contains `|`. Different prompt+cwd pairs can return wrong cached results.
- **Fix**: Use null byte separator `\0`, or hash `JSON.stringify([prompt, cwd])`.

### H4: Empty Rule ID From Special-Character Names
- **Source**: Bug Hunter
- **Files**: `src/rule-builder.js:6-11`, `src/schema.js:48-57`
- **Impact**: Names with only special characters (e.g., `"!!!"`) produce `id: ""`, which bypasses duplicate detection and breaks rule identification.
- **Fix**: Guard in `buildRule()`: if generated ID is empty, throw or generate UUID fallback. Validate `id !== ""` in `validateConfig()`.

---

## TIER 2: Fix Soon (MEDIUM severity)

### Security

| # | Finding | Files | Source |
|---|---------|-------|--------|
| S1 | `isUnsafeRegex` bypass via lookbehind `(?<=a\|a)+` | `schema.js:19` | Security |
| S2 | Runtime config not validated in `hook.js loadRules()` | `hook.js:52-56` | Security |
| S3 | No symlink check in `rule-builder.js appendRule()` | `rule-builder.js:49-53` | Security |
| S4 | Silent fail-open: all errors swallowed, block rules silently disabled | `hook.js` (multiple) | Security |
| S5 | LLM prompt injection in Layer 2 (mitigated, disabled by default) | `hook.js:225-232` | Security |

### Bugs

| # | Finding | Files | Source |
|---|---------|-------|--------|
| B1 | `cacheTTL \|\| 300000` prevents setting TTL to 0 (use `??`) | `hook.js:317,236` | Bug Hunter |
| B2 | Missing `config` section crashes hook with generic error | `hook.js:312,317` | Bug Hunter |
| B3 | Cache not invalidated when rules config changes | `hook.js:58-60,314-322` | Bug Hunter |
| B4 | LLM fallback non-matches never cached — repeated expensive calls | `hook.js:340-343` | Bug Hunter |
| B5 | `executeCreate` orphans markdown file on rule append failure | `creator.js:77-92` | Bug Hunter |
| B6 | YAML frontmatter injection via name/description | `creator.js:26-31` | Bug Hunter + Security |
| B7 | Hook `main()` swallows all errors with generic message | `hook.js:345` | Bug Hunter + Security |

### Quality

| # | Finding | Files | Source |
|---|---------|-------|--------|
| Q1 | Inconsistent error handling patterns across 5 modules | Multiple | Quality |
| Q2 | Missing input validation on public API boundaries | `router.js`, `rule-builder.js` | Quality |
| Q3 | Duplicated regex validation logic across 3 locations | `creator.js`, `cli.js`, `schema.js` | Quality |
| Q4 | Layer 2 (LLM fallback) missing from library API entirely | `router.js` (absent) | Quality |

---

## TIER 3: Improve When Convenient (LOW severity)

### Bugs & Security

| # | Finding | Files |
|---|---------|-------|
| L1 | TOCTOU race in symlink checks (requires local attacker) | `creator.js:35-41`, `scaffold.js:29-35` |
| L2 | Non-atomic writes for history/settings | `router.js:313`, `scaffold.js:89` |
| L3 | `parseInt("0") \|\| 2` prevents `minMatches: 0` | `rule-builder.js:21` |
| L4 | `wireSettings` returns `false` for both "already wired" and "malformed JSON" | `scaffold.js:69,86` |
| L5 | Read-then-write race condition in `appendRule`/`recordMatch` | `rule-builder.js:28-55`, `hook.js:258-268` |
| L6 | Aggregate regex timeout multiplication (N rules × M patterns × 100ms) | `router.js:31-36`, `hook.js:91-93` |
| L7 | Directory listing via `detectFileContext` with caller-supplied cwd | `router.js:89`, `hook.js:133` |
| L8 | `wireSettings` skips symlink check unlike other write paths | `scaffold.js:61-91` |
| L9 | `Buffer.prototype.slice` deprecated (use `subarray`) | `hook.js:45` |
| L10 | `hookCreated` is always `true` — misleading variable | `scaffold.js:36` |

### Quality & Docs

| # | Finding | Files |
|---|---------|-------|
| L11 | `scaffold()` declared async but uses only sync operations | `scaffold.js:14` |
| L12 | Double `buildRule()` call in create command | `cli.js:200,213` |
| L13 | Magic numbers throughout (6, 50, 10, 2*60*60*1000) | `router.js`, `hook.js` |
| L14 | Naming inconsistencies between router.js and hook.js | Multiple functions |

---

## DOCUMENTATION FIXES (separate track)

### Must Fix

| # | Issue | Location |
|---|-------|----------|
| D1 | README test badge: "61 passing" → actual is **71 passing** | `README.md:7` |
| D2 | README test output format doesn't match actual `formatDryRun()` output | `README.md:103-122,224-235` |
| D3 | README caching description claims "first 200 chars" — code uses full prompt | `README.md:496` |
| D4 | README `--force` flag claims confirmation prompt — code doesn't prompt | `README.md:158,165` |
| D5 | SECURITY-AUDIT.md stale: 8+ findings shown as open are already fixed | `SECURITY-AUDIT.md` |

### Should Fix

| # | Issue | Location |
|---|-------|----------|
| D6 | README `add-rule` wizard format inaccurate (comma-separated, not per-line) | `README.md:247-261` |
| D7 | No CHANGELOG.md for a published package | (missing) |
| D8 | SECURITY-AUDIT.md version says v0.1.0, package is v0.1.1 | `SECURITY-AUDIT.md:1` |

---

## CROSS-CUTTING PATTERNS

### 1. router.js ↔ hook.js Duplication (~300 lines)
The entire routing engine is duplicated between the library (`src/router.js`) and the standalone hook (`templates/hook.js`). This is architecturally intentional (hook must be standalone CJS), but creates maintenance risk: every bug fix must be applied twice with slightly different naming conventions. **Recommendation**: Add a build step or at minimum prominent cross-reference comments.

### 2. Inconsistent `||` vs `??` Usage
At least 4 findings trace to using `||` where `??` is needed, preventing users from setting falsy-but-valid values (0, empty string). This pattern appears in `hook.js`, `rule-builder.js`, and `router.js`.

### 3. Validation Gap: Schema → Runtime
`schema.js` validates configs at write time, but `hook.js` never calls `validateConfig()` at runtime. Hand-edited configs bypass all protections. This is the single biggest security gap remaining.

### 4. Error Opacity in Hook
The hook (most critical code path — runs on every prompt) has the weakest error reporting. Generic error messages + silent fail-open behavior makes misconfiguration nearly impossible to diagnose.

---

## KNOWN-GOOD: Items Confirmed Safe

| Item | Status |
|------|--------|
| npm tarball: no credentials, PII, or hardcoded paths | CLEAN |
| `execFileSync("claude")`: no shell injection | SAFE |
| `JSON.parse`: no prototype pollution | SAFE |
| Rule ID sanitization: no path traversal | SAFE |
| Starter rules: all 12 patterns are ReDoS-safe | SAFE |
| `npm audit`: 0 vulnerabilities in dependencies | SAFE |
| Author attribution (name, GitHub URL): appropriate | ACCEPTABLE |

---

## RECOMMENDED FIX ORDER

### Before v0.1.2 (blocking)
1. **H1**: Non-array keywords type validation
2. **H4**: Empty rule ID guard
3. **B2**: Missing config section crash guard
4. **D1**: Fix README test badge (61 → 71)

### Before v0.2.0 (important)
5. **H2**: Keyword word-boundary matching (breaking change — document)
6. **H3**: Cache key delimiter fix
7. **S1**: Lookbehind bypass in `isUnsafeRegex`
8. **S2**: Runtime validation in hook.js
9. **S3**: Symlink check in rule-builder.js
10. **B1**: `||` → `??` across codebase
11. **D2-D5**: README and SECURITY-AUDIT.md accuracy fixes

### v0.3.0+ (quality)
12. **Q1**: Standardize error handling patterns
13. **Q4**: Decide on Layer 2 as public API or hook-only
14. Hook.js test coverage (currently 0%)
15. Build step for router.js → hook.js synchronization

---

## AGENT CONTRIBUTIONS

| Agent | Findings | Unique | Overlap |
|-------|----------|--------|---------|
| Security Reviewer | 11 | 6 | 5 (with Bug Hunter, Quality) |
| Bug Hunter | 16 | 10 | 6 (with Security, Quality) |
| Artifact Scanner | 7 | 7 | 0 |
| Quality Reviewer | 16 | 10 | 6 (with Bug Hunter, Security) |
| Test/Docs Reviewer | 20 | 16 | 4 (with Quality) |
| **Total raw** | **70** | — | — |
| **Deduplicated** | **~50** | — | — |

---

*Generated by 5-agent parallel review team, consolidated by team lead.*
*claude-dispatch repository: https://github.com/wwadley-lucas/claude-dispatch*
