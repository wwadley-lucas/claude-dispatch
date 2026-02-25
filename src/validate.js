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
