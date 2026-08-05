// Guards against the i18n locale files silently diverging over time.
// Every locale file must expose the exact same set of translation keys.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const LOCALES_DIR = fileURLToPath(new URL('../../src/locales/', import.meta.url));

function flattenKeys(obj, prefix = '') {
  const keys = new Set();
  for (const [key, value] of Object.entries(obj)) {
    const path = prefix ? `${prefix}.${key}` : key;
    keys.add(path);
    if (value && typeof value === 'object' && !Array.isArray(value)) {
      for (const child of flattenKeys(value, path)) keys.add(child);
    }
  }
  return keys;
}

const localeFiles = readdirSync(LOCALES_DIR)
  .filter((file) => file.endsWith('.json'))
  .sort();

const parsed = {};
for (const file of localeFiles) {
  parsed[file] = JSON.parse(readFileSync(join(LOCALES_DIR, file), 'utf8'));
}

test('every locale file is valid JSON and shares the same key set as en.json', () => {
  assert.ok(localeFiles.length >= 2, 'expected at least 2 locale files');
  const enKeys = flattenKeys(parsed['en.json']);
  for (const file of localeFiles) {
    assert.deepEqual(
      [...flattenKeys(parsed[file])].sort(),
      [...enKeys].sort(),
      `key set of ${file} diverges from en.json`
    );
  }
});

test('all locales contain the banner and recently added keys', () => {
  const requiredKeys = [
    'messages.templateLoadedBanner',
    'messages.templateCopiedBanner',
    'buttons.saveDay',
    'buttons.finishStudy',
    'messages.completeOtherDaysFirst',
    'messages.daySavedStayOnPage',
  ];
  for (const file of localeFiles) {
    const keys = flattenKeys(parsed[file]);
    for (const key of requiredKeys) {
      assert.ok(keys.has(key), `${file} is missing key '${key}'`);
    }
  }
});

test('all translation values are strings or nested objects', () => {
  const walk = (obj, file, path = '') => {
    for (const [key, value] of Object.entries(obj)) {
      const full = path ? `${path}.${key}` : key;
      assert.ok(
        typeof value === 'string' || (value && typeof value === 'object'),
        `${file}.${full} is neither a string nor an object`
      );
    }
  };
  for (const file of localeFiles) {
    walk(parsed[file], file);
  }
});
