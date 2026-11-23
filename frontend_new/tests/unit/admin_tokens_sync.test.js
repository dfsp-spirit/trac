/**
 * The admin portal's tokens must match the app's brand layer.
 *
 * `src/styles/tokens.css` is the single source; the backend serves a generated
 * copy so the admin and the participant app share colour, type and geometry
 * without the admin ever importing app components. Two copies drift, so this
 * test is what stops it - the failure message points at the sync command.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';

import { SOURCE, TARGET, expected, inSync } from '../../tools/sync-admin-tokens.mjs';

test('the admin token copy is up to date', () => {
  assert.ok(
    inSync(),
    'run `npm run sync:admin-tokens` and commit backend/.../static/tokens.css'
  );
});

test('the shared token source actually exists', () => {
  assert.ok(existsSync(SOURCE));
  assert.ok(readFileSync(SOURCE, 'utf8').includes('--font-sans'));
  assert.ok(expected().includes('GENERATED FILE'));
  assert.ok(existsSync(TARGET));
});
