# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## [0.1.2] - 2026-03-07

### Fixed
- Non-array keywords/patterns now rejected by validation (previously caused silent character iteration)
- Keyword matching uses word boundaries instead of substring matching (prevents false positives)
- Cache key uses null byte separator to prevent delimiter collisions
- Empty rule IDs from special-character names now caught by validation
- isUnsafeRegex detects lookbehind group patterns
- Runtime config validation in hook prevents hand-edited config bypass
- Symlink check added to rule-builder appendRule
- cacheTTL and llmTimeout use nullish coalescing (can now be set to 0)
- Missing config section no longer crashes hook with opaque error
- Cache invalidates when rules config file is modified
- LLM fallback non-matches are now cached (prevents repeated expensive calls)
- Hook error handler logs actual error message
- Orphaned markdown files cleaned up on rule append failure
- YAML frontmatter values properly escaped
- Atomic writes for history and settings files
- Buffer.slice replaced with Buffer.subarray (Node.js 18+ compat)
- Magic numbers extracted to named constants

### Added
- Security & Limitations section in README covering LLM injection surface, regex performance guidance, and known limitations (TOCTOU, read-write races, directory listing)

### Changed
- Keyword matching documentation corrected from "substring" to "word-boundary" (code was already fixed in H2)
- Hook function `recordTopMatch` renamed to `recordMatch` for consistency with router.js
- Error-convention doc comments added to all 5 source module headers
- wireSettings returns rich result object with failure reason
- scaffold() is no longer async (was using only sync operations)
- Redundant regex validation removed from creator.js (schema.js is canonical)

## [0.1.1] - 2026-03-06

### Fixed
- Security audit findings addressed (per-regex timeout, prompt length cap, path traversal validation)
- Published to npm registry

## [0.1.0] - 2026-03-05

### Added
- Initial release
- Layer 1 keyword/regex routing engine
- Layer 1.5 context signals (directory, file type, project markers, skill sequences)
- Layer 2 optional LLM fallback
- CLI commands: init, validate, test, add-rule, create
- 12 starter rules
- 61 tests
