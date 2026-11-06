import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { previewText } from '../../src/js/ui/multiDayHint.js';
import { describeSkipped } from '../../src/js/ui/messages.js';

const locales = Object.fromEntries(
  ['de', 'en', 'sv'].map((language) => [
    language,
    JSON.parse(readFileSync(new URL(`../../src/locales/${language}.json`, import.meta.url), 'utf8')),
  ])
);

/**
 * The app's translator, minus the language switch: it reads the shipped German
 * and English strings, so the assertions below are the sentences a participant
 * actually sees rather than the keys.
 */
/** @param {string} language */
function translator(language) {
  const messages = /** @type {Record<string, any>} */ (locales[language]);
  return (/** @type {string} */ key, /** @type {Record<string, string | number>} */ params = {}) =>
    key.split('.').reduce((node, part) => node?.[part], messages)
      .replace(/\{\{(\w+)\}\}/g, (_, name) => String(params[name]));
}

const DAY_NAMES = {
  de: ['Montag', 'Dienstag', 'Mittwoch', 'Donnerstag'],
  en: ['Monday', 'Tuesday', 'Wednesday', 'Thursday'],
};
const days = ['monday', 'tuesday', 'wednesday', 'thursday'].map((name, index) => ({
  index,
  name,
  displayNames: { de: DAY_NAMES.de[index], en: DAY_NAMES.en[index] },
}));

/** @param {Array<[number, 'added' | 'skipped', string?]>} rows */
function plan(rows) {
  return rows.map(([dayIndex, status, code]) => (code ? { dayIndex, status, code } : { dayIndex, status }));
}

test('one day is the everyday save and says nothing', () => {
  assert.equal(previewText(translator('de'), plan([[0, 'added']]), days, 'de'), '');
});

test('a plan that lands everywhere confirms the day count', () => {
  const text = previewText(
    translator('de'),
    plan([[0, 'added'], [1, 'added'], [2, 'added']]),
    days,
    'de'
  );
  assert.equal(text, 'Wird an 3 Tagen eingetragen');
});

test('a partial plan names the days it will skip', () => {
  const text = previewText(
    translator('de'),
    plan([[0, 'added'], [1, 'skipped', 'overlap.limit_reached'], [2, 'skipped', 'activity.duplicate']]),
    days,
    'de'
  );
  assert.equal(text, 'Wird an 1 von 3 Tagen eingetragen · Dienstag, Mittwoch übersprungen');
});

test('a plan in which nothing lands stays quiet: the anchor error is the message', () => {
  const text = previewText(
    translator('de'),
    plan([[0, 'skipped', 'overlap.limit_reached'], [1, 'skipped', 'overlap.limit_reached']]),
    days,
    'de'
  );
  assert.equal(text, '');
});

test('the preview follows the interface language', () => {
  const text = previewText(
    translator('en'),
    plan([[0, 'added'], [1, 'skipped', 'overlap.limit_reached'], [2, 'added']]),
    days,
    'en'
  );
  assert.equal(text, 'Adds it to 2 of 3 days · Tuesday skipped');
});

test('the toast names every skipped day, grouped by reason', () => {
  const text = describeSkipped(
    translator('de'),
    [
      { day_label_index: 1, code: 'overlap.limit_reached' },
      { day_label_index: 2, code: 'overlap.limit_reached' },
      { day_label_index: 3, code: 'activity.duplicate' },
    ],
    days,
    'de'
  );
  assert.equal(
    text,
    'Nicht hinzugefügt: Dienstag, Mittwoch (Diese Zeit ist belegt), Donnerstag (Bereits eingetragen)'
  );
});

test('the toast still names its single day, not just the reason', () => {
  const text = describeSkipped(
    translator('en'),
    [{ day_label_index: 1, code: 'overlap.limit_reached' }],
    days,
    'en'
  );
  assert.equal(text, 'Not added: Tuesday (This time is full)');
});
