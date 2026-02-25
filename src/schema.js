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
