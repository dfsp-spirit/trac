#!/usr/bin/env node
/**
 * Copy the locale files into the rewrite so it can be deployed on its own.
 *
 * `frontend/src/locales/` stays the single source of truth (D35): the old app and
 * the rewrite share one set of translations, and every key for this app lives
 * under `diary.*`. The rewrite needs its own copy only because it must not
 * depend on a web-server alias at the site root - a deployment copies
 * `frontend_new/src/` as one self-contained directory.
 *
 *   node tools/sync-locales.mjs          # copy
 *   node tools/sync-locales.mjs --check  # fail if the copies differ (used by tests)
 *
 * `tests/unit/locales_sync.test.js` runs the check, so a stray edit to either
 * side fails the build instead of drifting.
 */
import { copyFileSync, mkdirSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
export const SOURCE_DIR = join(root, '..', 'frontend', 'src', 'locales');
export const TARGET_DIR = join(root, 'src', 'locales');

/** @returns {string[]} Locale file names, sorted, e.g. ['de.json', 'en.json']. */
export function localeFiles() {
  return readdirSync(SOURCE_DIR)
    .filter((name) => name.endsWith('.json'))
    .sort();
}

/**
 * Which files differ between the source and the copy.
 *
 * @returns {{ missing: string[], different: string[] }}
 */
export function drift() {
  const files = localeFiles();
  let present = [];
  try {
    present = readdirSync(TARGET_DIR);
  } catch {
    return { missing: files, different: [] };
  }
  const missing = [];
  const different = [];
  for (const file of files) {
    if (!present.includes(file)) {
      missing.push(file);
      continue;
    }
    // Compare parsed, not bytes: formatting is nobody's business here.
    const same =
      JSON.stringify(JSON.parse(readFileSync(join(SOURCE_DIR, file), 'utf8'))) ===
      JSON.stringify(JSON.parse(readFileSync(join(TARGET_DIR, file), 'utf8')));
    if (!same) different.push(file);
  }
  return { missing, different };
}

export function sync() {
  mkdirSync(TARGET_DIR, { recursive: true });
  for (const file of localeFiles()) {
    copyFileSync(join(SOURCE_DIR, file), join(TARGET_DIR, file));
  }
  return localeFiles();
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  if (process.argv.includes('--check')) {
    const { missing, different } = drift();
    if (missing.length || different.length) {
      console.error(
        `locales out of sync: missing [${missing.join(', ')}], different [${different.join(', ')}]\n` +
          'Run `npm run sync:locales` and commit the result.'
      );
      process.exit(1);
    }
    console.log('locales: in sync');
  } else {
    const files = sync();
    console.log(`locales: copied ${files.join(', ')} into src/locales/`);
  }
}
