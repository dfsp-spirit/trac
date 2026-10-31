/**
 * The locale copy the app ships must match the shared source.
 *
 * `frontend/src/locales/` is the one place translations are edited (D35), and
 * `src/locales/` is the copy that makes the rewrite deployable on its own. Two
 * copies would normally drift; this test is the thing that stops it, so the
 * failure message can simply point at `npm run sync:locales`.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { drift, localeFiles } from '../../tools/sync-locales.mjs';

test('the bundled locales are a verbatim copy of the shared ones', () => {
  const { missing, different } = drift();
  assert.deepEqual(
    { missing, different },
    { missing: [], different: [] },
    'run `npm run sync:locales` and commit src/locales/'
  );
});

test('there is a locale file to copy, so the check cannot pass vacuously', () => {
  assert.ok(localeFiles().length > 0);
});
