#!/usr/bin/env node
/**
 * Copy the design tokens into the admin portal.
 *
 * `frontend_new/src/styles/tokens.css` is the brand layer both user interfaces
 * share: colour, type, spacing, radii, shadows and focus. The admin portal is a
 * separate deployable (Jinja templates served from the backend package), so it
 * needs its own copy - and two copies drift unless something checks them.
 *
 *   node tools/sync-admin-tokens.mjs          # copy
 *   node tools/sync-admin-tokens.mjs --check  # fail if the copy differs
 *
 * `tests/unit/admin_tokens_sync.test.js` runs the check, so a token edit that is
 * not synced fails the frontend tests. The admin still owns its component styles
 * and its semantic status colours in `admin.css`; only the tokens are shared.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

export const SOURCE = fileURLToPath(
  new URL('../src/styles/tokens.css', import.meta.url)
);
export const TARGET = fileURLToPath(
  new URL(
    '../../backend/src/o_timeusediary_backend/static/tokens.css',
    import.meta.url
  )
);

const HEADER = `/*
 * GENERATED FILE - do not edit.
 *
 * Copied verbatim from frontend_new/src/styles/tokens.css by
 * \`npm run sync:admin-tokens\` (frontend_new/tools/sync-admin-tokens.mjs).
 * The admin portal loads this before admin.css so both user interfaces read as
 * one product. Change the source, then run the sync.
 */

`;

/** @returns {string} The exact file the admin should serve. */
export function expected() {
  return HEADER + readFileSync(SOURCE, 'utf8');
}

/** @returns {boolean} True when the admin copy is up to date. */
export function inSync() {
  try {
    return readFileSync(TARGET, 'utf8') === expected();
  } catch {
    return false;
  }
}

const check = process.argv.includes('--check');
if (check) {
  if (!inSync()) {
    console.error(
      'admin tokens: out of date - run `npm run sync:admin-tokens` in frontend_new/ and commit the result'
    );
    process.exit(1);
  }
  console.log('admin tokens: up to date');
} else {
  writeFileSync(TARGET, expected());
  console.log(`admin tokens: wrote ${TARGET}`);
}
