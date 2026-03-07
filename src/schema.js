// src/schema.js
// Error convention: returns { valid: boolean, errors: string[] }. Never throws.
import path from "node:path";

const REQUIRED_RULE_FIELDS = ["id", "name", "category", "command", "enforcement", "keywords", "patterns", "description"];
const VALID_ENFORCEMENTS = ["suggest", "silent", "block"];

/**
 * Detect potentially unsafe regex patterns that could cause catastrophic backtracking (ReDoS).
 * Returns true if the pattern is unsafe.
 */
export function isUnsafeRegex(pat) {
  // 1. Nested quantifiers: quantifier inside group, group itself quantified
  //    Catches: (a+)+, (a*)+, (a?)+, (a{2,})+, (\w+)*, etc.
  if (/([+*?]|\{[^}]*\})\s*\)[\s\S]*?([+*]|\{[^}]*\})/.test(pat)) {
    return true;
  }
  // 2. Quantified group containing alternation (overlap risk)
  //    Catches: (a|a)+, (?:a|b)*, (x|xy)+, etc.
  if (/\((?:\?[:=!<])?[^)]*\|[^)]*\)\s*([+*]|\{[^}]*\})/.test(pat)) {
    return true;
  }
  return false;
}

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
      if (rule[field] === undefined || rule[field] === null || (field === 'id' && rule[field] === '')) {
        errors.push(`${prefix}: missing required field "${field}"`);
      }
    }

    if (rule.id !== undefined && rule.id !== null) {
      if (seenIds.has(rule.id)) {
        errors.push(`${prefix}: duplicate rule ID "${rule.id}"`);
      }
      seenIds.add(rule.id);
    }

    if (rule.enforcement && !VALID_ENFORCEMENTS.includes(rule.enforcement)) {
      errors.push(`${prefix}: invalid enforcement "${rule.enforcement}" (must be suggest, silent, or block)`);
    }

    if (rule.keywords !== undefined && !Array.isArray(rule.keywords)) {
      errors.push(`${prefix}: keywords must be an array, got ${typeof rule.keywords}`);
    }
    if (rule.patterns !== undefined && !Array.isArray(rule.patterns)) {
      errors.push(`${prefix}: patterns must be an array, got ${typeof rule.patterns}`);
    }

    if (Array.isArray(rule.keywords) && rule.keywords.some((k) => typeof k !== "string")) {
      errors.push(`${prefix}: keywords must be an array of strings`);
    }

    if (Array.isArray(rule.patterns)) {
      for (let j = 0; j < rule.patterns.length; j++) {
        const pat = rule.patterns[j];
        try {
          new RegExp(pat);
        } catch {
          errors.push(`${prefix}: invalid regex pattern at index ${j}: "${pat}"`);
        }
        if (isUnsafeRegex(pat)) {
          errors.push(`${prefix}: potentially unsafe regex (ReDoS risk) at index ${j}: "${pat}"`);
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
        } else {
          try {
            new RegExp(sig.pattern);
          } catch {
            errors.push(`directorySignals[${i}]: invalid regex pattern: "${sig.pattern}"`);
          }
          if (isUnsafeRegex(sig.pattern)) {
            errors.push(`directorySignals[${i}]: potentially unsafe regex (ReDoS risk): "${sig.pattern}"`);
          }
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
        if (marker.file && (path.isAbsolute(marker.file) || marker.file.includes(".."))) {
          errors.push(`projectMarkers[${i}]: "file" must be a relative path without ".." segments`);
        }
        if (marker.absent && (path.isAbsolute(marker.absent) || marker.absent.includes(".."))) {
          errors.push(`projectMarkers[${i}]: "absent" must be a relative path without ".." segments`);
        }
      }
    }
  }

  // Validate optional config numeric fields
  if (config.config) {
    const cfg = config.config;
    const numericFields = { maxMatches: [1, 100], minScore: [0, 100], cacheTTL: [0, 86400000], llmTimeout: [1000, 60000] };
    for (const [field, [min, max]] of Object.entries(numericFields)) {
      if (cfg[field] !== undefined) {
        if (typeof cfg[field] !== "number" || !Number.isFinite(cfg[field]) || cfg[field] < min || cfg[field] > max) {
          errors.push(`config.${field}: must be a finite number between ${min} and ${max}`);
        }
      }
    }
  }

  return { valid: errors.length === 0, errors };
}
