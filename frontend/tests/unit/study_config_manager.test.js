// Unit tests for the pure helper functions in study_config_manager.js.
// These cover the day-label localization logic (the source of the "Måndag"
// banner bug) and study-text resolution.
import './setup.js';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  normalizeDayLabels,
  resolveLocalizedStudyText,
  normalizeLanguageCode,
} from '../../src/js/study_config_manager.js';

const multiLangStudy = {
  default_language: 'sv',
  day_labels: [
    {
      name: 'monday',
      display_order: 0,
      display_names: { en: 'Monday', sv: 'Måndag', de: 'Montag' },
    },
    { name: 'tuesday', display_order: 1, display_name: 'Legacy Tuesday' },
  ],
};

test('normalizeDayLabels resolves display_names for the requested language', () => {
  assert.equal(normalizeDayLabels(multiLangStudy, 'en')[0].display_name, 'Monday');
  assert.equal(normalizeDayLabels(multiLangStudy, 'sv')[0].display_name, 'Måndag');
  assert.equal(normalizeDayLabels(multiLangStudy, 'de')[0].display_name, 'Montag');
});

test('normalizeDayLabels falls back to the study default language when the requested language is missing', () => {
  const labels = normalizeDayLabels(multiLangStudy, 'pl');
  assert.equal(labels[0].display_name, 'Måndag'); // default_language is 'sv'
});

test('normalizeDayLabels falls back to en, then first value, then name', () => {
  const enOnly = normalizeDayLabels(
    {
      default_language: 'xx',
      day_labels: [{ name: 'monday', display_names: { en: 'Monday' } }],
    },
    'zz'
  );
  assert.equal(enOnly[0].display_name, 'Monday');

  const nameOnly = normalizeDayLabels(
    { default_language: 'en', day_labels: [{ name: 'monday' }] },
    'en'
  );
  assert.equal(nameOnly[0].display_name, 'monday');
});

test('normalizeDayLabels keeps plain string display_name and preserves the display_names map', () => {
  const labels = normalizeDayLabels(multiLangStudy, 'en');
  assert.equal(labels[1].display_name, 'Legacy Tuesday');
  assert.deepEqual(labels[0].display_names, {
    en: 'Monday',
    sv: 'Måndag',
    de: 'Montag',
  });
});

test('normalizeDayLabels handles missing day_labels and non-object entries', () => {
  assert.deepEqual(normalizeDayLabels({}, 'en'), []);
  assert.deepEqual(normalizeDayLabels({ day_labels: ['raw'] }, 'en'), ['raw']);
});

test('resolveLocalizedStudyText returns plain strings unchanged', () => {
  assert.equal(resolveLocalizedStudyText('plain', 'en'), 'plain');
});

test('resolveLocalizedStudyText prefers selected language, then default, then en', () => {
  const map = { en: 'Hello', de: 'Hallo' };
  assert.equal(resolveLocalizedStudyText(map, 'de', 'en'), 'Hallo');
  assert.equal(resolveLocalizedStudyText(map, 'sv', 'en'), 'Hello'); // -> en
  assert.equal(resolveLocalizedStudyText(map, 'sv', 'de'), 'Hallo'); // -> default de
});

test('resolveLocalizedStudyText falls back to the first string value when no language matches', () => {
  const noEnglish = { sv: 'Hej', fi: 'Moi' };
  assert.equal(resolveLocalizedStudyText(noEnglish, 'pl', 'en'), 'Hej');
});

test('resolveLocalizedStudyText returns null for null / non-object input', () => {
  assert.equal(resolveLocalizedStudyText(null, 'en'), null);
  assert.equal(resolveLocalizedStudyText(undefined, 'en'), null);
  assert.equal(resolveLocalizedStudyText(42, 'en'), null);
});

test('normalizeLanguageCode normalizes and validates language codes', () => {
  assert.equal(normalizeLanguageCode('en'), 'en');
  assert.equal(normalizeLanguageCode('EN-US'), 'en');
  assert.equal(normalizeLanguageCode('  sv  '), 'sv');
  assert.equal(normalizeLanguageCode(''), null);
  assert.equal(normalizeLanguageCode(null), null);
  assert.equal(normalizeLanguageCode(undefined), null);
  assert.equal(normalizeLanguageCode('123'), null);
  assert.equal(normalizeLanguageCode('e'), null);
  assert.equal(normalizeLanguageCode('english'), null);
});
