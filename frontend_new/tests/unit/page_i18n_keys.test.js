import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

// Guards the i18n contract for the new frontend (D34, D35):
//
//  * every key the markup and the code ask for exists in de, en and sv;
//  * the new UI references only `diary.*` plus the shell allowlist, so it can
//    never depend on an old diary key that is deleted at cutover;
//  * `diary.*` values are plain text - no markup, no entities - so there is
//    nothing for a translator to break;
//  * plural keys carry both `_one` and `_other`.
//
// The old frontend has its own copy of this guard over `frontend/src`; this one
// scans `frontend_new/src` and reads the same shared locale files.

const SRC_DIR = fileURLToPath(new URL('../../src/', import.meta.url));
const LOCALES_DIR = fileURLToPath(new URL('../../../frontend/src/locales/', import.meta.url));

/** Namespaces the new UI may borrow from the surviving pages (D35). */
const SHELL_ALLOWLIST = ['common.', 'footer.', 'maintenance.', 'idleTimeout.'];

/** @param {string} dir @param {(file: string) => boolean} predicate @param {string[]} [out] */
function walk(dir, predicate, out = []) {
  for (const entry of readdirSync(dir)) {
    if (entry === 'node_modules') continue;
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) walk(full, predicate, out);
    else if (predicate(full)) out.push(full);
  }
  return out;
}

/** @param {Record<string, unknown>} messages @param {string} key */
function lookup(messages, key) {
  return key.split('.').reduce(
    (node, part) =>
      node && typeof node === 'object' && part in node
        ? /** @type {Record<string, unknown>} */ (node)[part]
        : undefined,
    /** @type {unknown} */ (messages)
  );
}

const localeFiles = readdirSync(LOCALES_DIR)
  .filter((file) => file.endsWith('.json'))
  .sort();

/** @type {Record<string, Record<string, unknown>>} */
const locales = {};
for (const file of localeFiles) {
  locales[file] = JSON.parse(readFileSync(join(LOCALES_DIR, file), 'utf8'));
}

const sourceFiles = walk(SRC_DIR, (file) => file.endsWith('.html') || file.endsWith('.js'));

/** @typedef {{ key: string, file: string, plural: boolean }} Reference */

/** @type {Reference[]} */
const references = [];
for (const file of sourceFiles) {
  const text = readFileSync(file, 'utf8');
  const relative = file.slice(SRC_DIR.length);
  for (const match of text.matchAll(/data-i18n(?:-aria-label|-title|-placeholder)?="([^"]+)"/g)) {
    references.push({ key: match[1], file: relative, plural: false });
  }
  for (const match of text.matchAll(/\bt\(\s*['"]([^'"]+)['"]/g)) {
    references.push({ key: match[1], file: relative, plural: false });
  }
  for (const match of text.matchAll(/\btCount\(\s*['"]([^'"]+)['"]/g)) {
    references.push({ key: match[1], file: relative, plural: true });
  }
}

test('the locale set is exactly the three supported languages', () => {
  assert.deepEqual(localeFiles, ['de.json', 'en.json', 'sv.json'], 'D34 dropped es, fi, fr and pl');
});

test('the scanner finds keys, so the guards below cannot pass vacuously', () => {
  assert.ok(sourceFiles.length >= 3, 'expected at least index.html, main.js and the i18n modules');
  assert.ok(references.length >= 10, `found only ${references.length} key references`);
});

test('every referenced key exists in every locale', () => {
  const missing = [];
  for (const reference of references) {
    for (const file of localeFiles) {
      if (typeof lookup(locales[file], reference.key) !== 'string') {
        missing.push(`${file}: ${reference.key} (referenced from ${reference.file})`);
      }
    }
  }
  assert.deepEqual(missing, []);
});

test('the new UI references only diary.* keys and the shell allowlist', () => {
  const offenders = references
    .filter(
      (reference) =>
        !reference.key.startsWith('diary.') &&
        !SHELL_ALLOWLIST.some((prefix) => reference.key.startsWith(prefix))
    )
    .map((reference) => `${reference.file}: ${reference.key}`);
  assert.deepEqual(offenders, [], 'old diary namespaces disappear at cutover (D35)');
});

test('diary.* values are plain text: no markup and no HTML entities', () => {
  const offenders = [];
  for (const file of localeFiles) {
    /** @param {Record<string, unknown>} node @param {string} path */
    const visit = (node, path) => {
      for (const [key, value] of Object.entries(node)) {
        const full = path ? `${path}.${key}` : key;
        if (value && typeof value === 'object') visit(/** @type {Record<string, unknown>} */ (value), full);
        else if (typeof value === 'string' && full.startsWith('diary.')) {
          if (/[<>]|&[a-z]+;/i.test(value)) offenders.push(`${file}: ${full} = ${value}`);
        }
      }
    };
    visit(locales[file], '');
  }
  assert.deepEqual(offenders, [], 'structure belongs in markup, not in translations (D35)');
});

test('plural references have both _one and _other in every locale', () => {
  const missing = [];
  for (const reference of references.filter((item) => item.plural)) {
    for (const file of localeFiles) {
      for (const suffix of ['_one', '_other']) {
        if (typeof lookup(locales[file], `${reference.key}${suffix}`) !== 'string') {
          missing.push(`${file}: ${reference.key}${suffix}`);
        }
      }
    }
  }
  assert.deepEqual(missing, []);
});

test('the new UI never renders translations as HTML', () => {
  const offenders = sourceFiles.filter((file) => readFileSync(file, 'utf8').includes('data-i18n-html'));
  assert.deepEqual(offenders.map((file) => file.slice(SRC_DIR.length)), []);
});
