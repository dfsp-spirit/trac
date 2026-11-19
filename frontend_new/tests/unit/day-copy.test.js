import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import {
  copyableDays,
  copySource,
  ownCounts,
  planCopy,
  weekdayGroups,
} from '../../src/js/domain/dayCopy.js';
import { previewText, sourceDetail } from '../../src/js/ui/copyDayText.js';
import { Codes } from '../../src/js/domain/validation.js';

const locales = Object.fromEntries(
  ['de', 'en', 'sv'].map((language) => [
    language,
    JSON.parse(readFileSync(new URL(`../../src/locales/${language}.json`, import.meta.url), 'utf8')),
  ])
);

/**
 * The app's translator, reading the shipped locales, so the assertions below are
 * the sentences a participant sees instead of the keys. `tCount` picks the
 * plural form the way `data/i18n.js` does.
 *
 * @param {string} language
 */
function translator(language) {
  const messages = /** @type {Record<string, any>} */ (locales[language]);
  /** @param {string} key */
  const lookup = (key) =>
    key
      .split('.')
      .reduce(
        (node, part) => (node && typeof node === 'object' && part in node ? node[part] : undefined),
        messages
      );
  const fill = (/** @type {string} */ template, /** @type {Record<string, string | number>} */ params) =>
    String(template).replace(/\{\{(\w+)\}\}/g, (_, name) => String(params[name]));

  return {
    t: (/** @type {string} */ key, /** @type {Record<string, string | number>} */ params = {}) =>
      fill(lookup(key), params),
    tCount: (/** @type {string} */ key, /** @type {number} */ count) =>
      fill(lookup(`${key}${count === 1 ? '_one' : '_other'}`), { count }),
  };
}

const NAMES = {
  de: ['Montag', 'Dienstag', 'Mittwoch', 'Donnerstag', 'Freitag', 'Samstag', 'Sonntag'],
  en: ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'],
};

/** @param {number} [count] */
function makeDays(count = 7) {
  return Array.from({ length: count }, (_, index) => ({
    index,
    name: `day_${index}`,
    displayName: NAMES.en[index],
    displayNames: { de: NAMES.de[index], en: NAMES.en[index] },
    has_data: false,
    coverage_minutes: 0,
    meets_requirement: false,
  }));
}

/** @param {{ day: number, start: number, end: number, code?: number, uuid?: string }} input */
function activity({ day, start, end, code = 1101, uuid }) {
  return {
    client_uuid: uuid || `u-${day}-${start}-${code}`,
    day_label_index: day,
    activity_code: code,
    activity_name: 'Activity',
    category: 'General',
    color: null,
    parent_activity_code: null,
    frequency_key: null,
    start_minutes: start,
    end_minutes: end,
  };
}

/** @param {any[]} activities @param {{ maxOverlap?: number, dayStart?: number, dayCount?: number }} [options] */
function diaryWith(activities, { maxOverlap = 2, dayStart = 0, dayCount = 7 } = {}) {
  return {
    schema_version: 1,
    study: { day_start_minutes: dayStart, submitted_at: null },
    timeline: { key: 'primary', display_name: 'Primary', min_coverage: 1440, max_overlap: maxOverlap },
    days: makeDays(dayCount),
    activities,
  };
}

test('a day that only shows the previous night counts as empty', () => {
  // The 23:00-01:00 entry belongs to day 0; day 1 merely shows its tail.
  const diary = diaryWith([activity({ day: 0, start: 1380, end: 1500 })]);

  assert.deepEqual([...ownCounts(diary)], [[0, 1]]);
  assert.deepEqual(copyableDays(diary), [0]);
});

test('the source summary counts entries and spans the day-relative range', () => {
  const diary = diaryWith([
    activity({ day: 0, start: 600, end: 660 }),
    activity({ day: 0, start: 1380, end: 1500, code: 1102 }),
  ]);

  assert.deepEqual(copySource(diary, 0), { count: 2, firstStart: 600, lastEnd: 1500 });
  assert.deepEqual(copySource(diary, 1), { count: 0, firstStart: null, lastEnd: null });
});

test('every target day receives the source rows', () => {
  const diary = diaryWith([activity({ day: 0, start: 600, end: 660 })]);

  const plan = planCopy({ diary, sourceIndex: 0, targetIndexes: [2, 4] });

  assert.deepEqual(plan, [
    { dayIndex: 2, status: 'copied', adds: 1, replaces: 0 },
    { dayIndex: 4, status: 'copied', adds: 1, replaces: 0 },
  ]);
});

test('a filled target is replaced, and the count says how much', () => {
  const diary = diaryWith([
    activity({ day: 0, start: 600, end: 660 }),
    activity({ day: 3, start: 480, end: 540 }),
    activity({ day: 3, start: 540, end: 600 }),
  ]);

  const [target] = planCopy({ diary, sourceIndex: 0, targetIndexes: [3] });

  assert.equal(target.status, 'copied');
  assert.equal(target.replaces, 2);
});

test('the last day cannot take a night entry, but other days can', () => {
  const diary = diaryWith([activity({ day: 0, start: 1380, end: 1500 })]);

  const plan = planCopy({ diary, sourceIndex: 0, targetIndexes: [2, 6] });

  assert.deepEqual(plan.map((target) => [target.dayIndex, target.status]), [
    [2, 'copied'],
    [6, 'skipped'],
  ]);
  assert.equal(plan[1].code, Codes.LAST_DAY_MIDNIGHT);
});

test('a tail from the night before can fill the target', () => {
  // Two entries on day 1 run into day 2 (two rows at 00:00-01:00), which is the
  // study's whole overlap allowance. Copying a 00:30-01:30 entry onto day 2 would
  // make three rows at the same time - and day 2's own rows do not help, because
  // the copy replaces them.
  const diary = diaryWith([
    activity({ day: 0, start: 30, end: 90 }),
    activity({ day: 1, start: 1380, end: 1500, code: 1101 }),
    activity({ day: 1, start: 1380, end: 1500, code: 1102 }),
    activity({ day: 2, start: 0, end: 60, code: 1103 }),
  ]);

  const [target] = planCopy({ diary, sourceIndex: 0, targetIndexes: [2] });

  assert.equal(target.status, 'skipped');
  assert.equal(target.code, Codes.OVERLAP_LIMIT);
});

test('the source day and days outside the study are not targets', () => {
  const diary = diaryWith([activity({ day: 0, start: 600, end: 660 })]);

  const plan = planCopy({ diary, sourceIndex: 0, targetIndexes: [0, 1, 9] });

  assert.deepEqual(plan.map((target) => [target.dayIndex, target.status, target.code]), [
    [1, 'copied', undefined],
    [9, 'skipped', Codes.DAY_OUT_OF_RANGE],
  ]);
});

test('the preview names what is overwritten and leaves empty days out', () => {
  const diary = diaryWith([
    activity({ day: 0, start: 600, end: 660 }),
    activity({ day: 2, start: 480, end: 540 }),
    activity({ day: 2, start: 540, end: 600 }),
  ]);
  const { t, tCount } = translator('de');
  const plan = planCopy({ diary, sourceIndex: 0, targetIndexes: [1, 2] });

  const text = previewText(t, tCount, {
    plan,
    days: diary.days,
    language: 'de',
    hasSource: true,
    hasTargets: true,
  });

  assert.equal(text, 'Wird überschrieben: Mittwoch (2 Einträge)');
});

test('the preview names a refused day instead of staying silent', () => {
  const diary = diaryWith([activity({ day: 0, start: 1380, end: 1500 })]);
  const { t, tCount } = translator('de');
  const plan = planCopy({ diary, sourceIndex: 0, targetIndexes: [6] });

  const text = previewText(t, tCount, {
    plan,
    days: diary.days,
    language: 'de',
    hasSource: true,
    hasTargets: true,
  });

  assert.match(text, /^Nicht kopiert: Sonntag \(/);
  assert.doesNotMatch(text, /diary\./);
});

test('without a source or a target the preview asks for one', () => {
  const { t, tCount } = translator('de');
  const days = makeDays(3);

  assert.equal(
    previewText(t, tCount, { plan: [], days, language: 'de', hasSource: false, hasTargets: false }),
    'Wähle den Tag, der kopiert wird.'
  );
  assert.equal(
    previewText(t, tCount, { plan: [], days, language: 'de', hasSource: true, hasTargets: false }),
    'Wähle einen oder mehrere Tage.'
  );
});

test('the source detail carries the count and the range, including a night entry', () => {
  const diary = diaryWith([
    activity({ day: 0, start: 600, end: 660 }),
    activity({ day: 0, start: 1380, end: 1500, code: 1102 }),
  ]);
  const { t, tCount } = translator('de');

  assert.equal(
    sourceDetail(t, tCount, copySource(diary, 0), 0),
    '2 Einträge · 10:00 – 01:00 (nächster Tag)'
  );
});

test('work days and the weekend are grouped from the study day names', () => {
  const days = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'].map(
    (name, index) => ({ index, name })
  );
  assert.deepEqual(weekdayGroups(days), {
    workdays: [0, 1, 2, 3, 4],
    weekend: [5, 6],
  });
});

test('the internal two-letter day names classify too', () => {
  const days = ['mo', 'tu', 'we', 'th', 'fr', 'sa', 'su'].map((name, index) => ({
    index,
    name,
  }));
  assert.deepEqual(weekdayGroups(days), { workdays: [0, 1, 2, 3, 4], weekend: [5, 6] });
});

test('custom day names get no shortcuts rather than a preset that leaves a day out', () => {
  assert.equal(weekdayGroups(makeDays()), null);
  assert.equal(
    weekdayGroups([
      { index: 0, name: 'monday' },
      { index: 1, name: 'day_1' },
    ]),
    null
  );
});

test('a study without weekend days still classifies its work days', () => {
  const days = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday'].map((name, index) => ({
    index,
    name,
  }));
  assert.deepEqual(weekdayGroups(days), { workdays: [0, 1, 2, 3, 4], weekend: [] });
});
