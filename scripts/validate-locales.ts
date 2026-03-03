#!/usr/bin/env node
/**
 * Locale validation script
 * 
 * Checks:
 * - All locale files have identical key sets as en.json
 * - Placeholder patterns are preserved ({{var}}, {TITLE}, etc.)
 * - JSON is valid
 * - Array lengths match (month/day names)
 */

import * as fs from 'fs';
import * as path from 'path';

const LOCALES_DIR = path.join(__dirname, '../src/i18n/locales');
const EN_FILE = path.join(LOCALES_DIR, 'en.json');

interface ValidationResult {
  file: string;
  issues: string[];
  fixed: string[];
}

// Placeholder patterns to preserve
const PLACEHOLDER_PATTERNS = [
  /\{\{(\w+)\}\}/g, // {{count}}, {{platform}}, etc.
  /\{TITLE\}/g,
  /\{DESCRIPTION\}/g,
  /\{HASHTAGS\}/g,
  /\{CTA\}/g,
  /\{LINKS\}/g,
  /\{DISCLAIMER\}/g,
];

function extractPlaceholders(text: string): string[] {
  const placeholders: string[] = [];
  for (const pattern of PLACEHOLDER_PATTERNS) {
    const matches = text.matchAll(pattern);
    for (const match of matches) {
      placeholders.push(match[0]);
    }
  }
  return [...new Set(placeholders)].sort();
}

function validateLocale(enData: Record<string, any>, localeFile: string): ValidationResult {
  const result: ValidationResult = {
    file: path.basename(localeFile),
    issues: [],
    fixed: [],
  };

  // Read and parse JSON
  let localeData: Record<string, any>;
  try {
    const content = fs.readFileSync(localeFile, 'utf-8');
    localeData = JSON.parse(content);
  } catch (error) {
    result.issues.push(`Invalid JSON: ${error}`);
    return result;
  }

  // Check keys match
  const enKeys = new Set(Object.keys(enData));
  const localeKeys = new Set(Object.keys(localeData));

  const missingKeys = [...enKeys].filter(k => !localeKeys.has(k));
  const extraKeys = [...localeKeys].filter(k => !enKeys.has(k));

  if (missingKeys.length > 0) {
    result.issues.push(`Missing keys: ${missingKeys.join(', ')}`);
  }
  if (extraKeys.length > 0) {
    result.issues.push(`Extra keys: ${extraKeys.join(', ')}`);
  }

  // Check placeholders for each key
  for (const key of enKeys) {
    if (!localeData[key]) continue;

    const enValue = String(enData[key]);
    const localeValue = String(localeData[key]);

    // Skip arrays (month/day names)
    if (Array.isArray(enData[key]) || Array.isArray(localeData[key])) {
      if (Array.isArray(enData[key]) && Array.isArray(localeData[key])) {
        if (enData[key].length !== localeData[key].length) {
          result.issues.push(`Key "${key}": array length mismatch (en: ${enData[key].length}, locale: ${localeData[key].length})`);
        }
      }
      continue;
    }

    const enPlaceholders = extractPlaceholders(enValue);
    const localePlaceholders = extractPlaceholders(localeValue);

    const missingPlaceholders = enPlaceholders.filter(p => !localePlaceholders.includes(p));
    const extraPlaceholders = localePlaceholders.filter(p => !enPlaceholders.includes(p));

    if (missingPlaceholders.length > 0) {
      result.issues.push(`Key "${key}": missing placeholders: ${missingPlaceholders.join(', ')}`);
    }
    if (extraPlaceholders.length > 0) {
      result.issues.push(`Key "${key}": extra placeholders: ${extraPlaceholders.join(', ')}`);
    }
  }

  return result;
}

function main() {
  console.log('Validating locale files...\n');

  // Load English reference
  let enData: Record<string, any>;
  try {
    enData = JSON.parse(fs.readFileSync(EN_FILE, 'utf-8'));
  } catch (error) {
    console.error(`Failed to load ${EN_FILE}:`, error);
    process.exit(1);
  }

  // Get all locale files
  const files = fs.readdirSync(LOCALES_DIR)
    .filter(f => f.endsWith('.json') && f !== 'en.json')
    .map(f => path.join(LOCALES_DIR, f));

  const results: ValidationResult[] = [];
  let totalIssues = 0;

  for (const file of files) {
    const result = validateLocale(enData, file);
    results.push(result);
    totalIssues += result.issues.length;
  }

  // Print report
  console.log('Validation Report\n');
  console.log('='.repeat(60));

  for (const result of results) {
    if (result.issues.length === 0) {
      console.log(`\n✓ ${result.file}: OK`);
    } else {
      console.log(`\n✗ ${result.file}: ${result.issues.length} issue(s)`);
      for (const issue of result.issues) {
        console.log(`  - ${issue}`);
      }
    }
  }

  console.log('\n' + '='.repeat(60));
  console.log(`\nTotal issues found: ${totalIssues}`);

  if (totalIssues > 0) {
    process.exit(1);
  } else {
    console.log('\n✓ All locale files are valid!');
  }
}

if (require.main === module) {
  main();
}

export { validateLocale, extractPlaceholders };
