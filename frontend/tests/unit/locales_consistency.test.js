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

// Look up a value by dot-path (e.g. 'messages.copyDayHasData').
function getByPath(obj, path) {
  return path.split('.').reduce((o, key) => (o == null ? o : o[key]), obj);
}

// Values that are intentionally identical across all locales: universal
// tokens, app/proper nouns, or genuine cognates that are correct in the
// target language (e.g. German "Name", French "Code"). These are NOT
// considered untranslated and are excluded from the untranslated-value check.
const LANGUAGE_NEUTRAL_VALUES = new Set([
  'OK', // universal acknowledgment
  'TRAC', // app name
  '✓', // symbol (timelineCoverageMet)
  'Start', // de/sv: "Start" is the natural word
  'Name', // de: German for "Name"
  'Code', // de: "Code" is the same word
  '{{count}} min', // sv: "min" is the SI-style abbreviation, same as en
  // The shared "<study> - <page>" title pattern: pure placeholder glue, no
  // words of its own, and every locale orders these two the same way.
  '{{study}} - {{page}}',
]);

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
    'messages.templateLoadedBannerMobile',
    'messages.templateLoadedBannerDesktop',
    'banner.instructionsMobile',
    'banner.instructionsDesktop',
    'messages.templateCopiedBanner',
    'buttons.submitStudy',
    'messages.timelineCleared',
    'messages.completeOtherDaysFirst',
    'messages.copyDayToAnother',
    'messages.goToCopiedDay',
    'messages.copyOverwriteTitle',
    'messages.copyOverwriteYes',
    'common.pageTitle',
    'common.pageTitleWithStudy',
    'common.error',
    // Consent page error states: the participant has to be able to tell a
    // broken link / paused study from a temporary backend problem.
    'consent.accessDenied',
    'consent.studyUnavailable',
    'consent.saveDenied',
    // Autosave status chip: only the failure is ever shown, so only these two
    // labels exist (see sync_status.test.js).
    'messages.syncNotSaved',
    'messages.syncRetry',
    // Footer links: external targets open in a new tab, and the accessible name
    // says so (same-origin targets get a dialog instead, see footer.js).
    'footer.opensInNewTab',
    // Timeline coverage wording: a timeline with no requirement and no entries
    // is reported as empty, not as a met requirement (no vacuous ✓), and the
    // phone-only row that advertises an untouched other timeline.
    'messages.timelineNothingEntered',
    'messages.timelineSwitchHintAria',
    // Instructions page: the collapsed walk-through's label and the diary's
    // "How to use the diary" menu entry / modal title.
    'instructions.howToSummary',
    'buttons.help',
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

// Guards against locales that share the en.json key set but keep the English
// text as the value (i.e. "untranslated"). This is what the key-set check
// above cannot catch. Language-neutral values are excluded via the allowlist.
test('non-English locales contain no untranslated English values', () => {
  const en = parsed['en.json'];
  for (const file of localeFiles) {
    if (file === 'en.json') continue;
    const untranslated = [];
    for (const key of flattenKeys(en)) {
      const enValue = getByPath(en, key);
      const value = getByPath(parsed[file], key);
      if (
        typeof enValue === 'string' &&
        typeof value === 'string' &&
        value === enValue &&
        enValue.trim() !== '' &&
        /[A-Za-z]/.test(enValue) && // ignore pure symbols like "✓"
        !LANGUAGE_NEUTRAL_VALUES.has(enValue)
      ) {
        untranslated.push(key);
      }
    }
    assert.deepEqual(
      untranslated,
      [],
      `${file} still has values identical to English (translate them): ${untranslated.join(', ')}`
    );
  }
});
