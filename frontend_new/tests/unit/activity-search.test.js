import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  filterEntries,
  flattenCatalogue,
  fold,
  groupByCategory,
  recentEntries,
} from '../../src/js/ui/activitySearch.js';

const config = {
  general: { version: '1' },
  timeline: {
    primary: {
      min_coverage: 1440,
      max_overlap: 3,
      categories: [
        {
          name: 'General',
          activities: [
            { code: 100, name: 'Sleeping', label: 'sleeping' },
            { code: 101, name: 'Äußern von Gefühlen', examples: 'Gefühle zeigen' },
            {
              code: 102,
              name: 'Travelling',
              childItems: [{ code: 1021, name: 'Travelling: cycle' }],
              frequency_options: [{ key: 'often', label: 'Often' }],
            },
          ],
        },
        {
          name: 'Work',
          activities: [{ code: 200, name: 'Paid work', is_custom_input: true }],
        },
      ],
    },
  },
};

test('the catalogue is flattened with children, options and timeline limits', () => {
  const { entries, categories, minCoverage, maxOverlap } = flattenCatalogue(config);
  assert.deepEqual(categories, ['General', 'Work']);
  assert.equal(entries.length, 4);
  assert.equal(minCoverage, 1440);
  assert.equal(maxOverlap, 3);

  const travelling = entries.find((entry) => entry.code === 102);
  assert.deepEqual(travelling.children, [{ code: 1021, name: 'Travelling: cycle' }]);
  assert.deepEqual(travelling.frequencyOptions, [{ key: 'often', label: 'Often' }]);
  assert.equal(entries.find((entry) => entry.code === 200).isCustomInput, true);
});

test('fold strips diacritics and normalises ß', () => {
  assert.equal(fold('Äußern'), 'aussern');
  assert.equal(fold('Måndag'), 'mandag');
  assert.equal(fold('  SLEEPING '), 'sleeping');
});

test('search matches names, examples and categories, ignoring case and accents', () => {
  const { entries } = flattenCatalogue(config);
  assert.deepEqual(filterEntries(entries, 'sleep').map((entry) => entry.code), [100]);
  assert.deepEqual(filterEntries(entries, 'gefuhle').map((entry) => entry.code), [101]);
  assert.deepEqual(filterEntries(entries, 'work').map((entry) => entry.code), [200]);
  assert.deepEqual(filterEntries(entries, 'ausser').map((entry) => entry.code), [101]);
});

test('word-start matches rank before inner matches', () => {
  const list = [
    { code: 1, name: 'Haircut', category: 'A', color: null, examples: null, isCustomInput: false, children: [], frequencyOptions: [], haystack: 'haircut a' },
    { code: 2, name: 'Wash hair', category: 'A', color: null, examples: null, isCustomInput: false, children: [], frequencyOptions: [], haystack: 'wash hair a' },
  ];
  assert.deepEqual(filterEntries(list, 'hair').map((entry) => entry.code), [1, 2]);
});

test('an empty query keeps catalogue order and grouping drops empty groups', () => {
  const { entries } = flattenCatalogue(config);
  assert.equal(filterEntries(entries, ''), entries);
  const groups = groupByCategory(filterEntries(entries, 'sleep'));
  assert.deepEqual(groups.map(([name]) => name), ['General']);
});

test('a query that matches nothing returns an empty list', () => {
  const { entries } = flattenCatalogue(config);
  assert.deepEqual(filterEntries(entries, 'zzz'), []);
});

// ── "Used recently" (D28) ──────────────────────────────────────────────────
// A shortcut row above the catalogue, derived from the participant's own diary:
// no endpoint, no device storage, and it must never offer a dead entry.

const { entries: RECENT_ENTRIES } = flattenCatalogue(config);

/** @param {number} code @param {string} stamp */
const used = (code, stamp) => ({
  activity_code: code,
  parent_activity_code: null,
  created_at: stamp,
  updated_at: stamp,
});

/** @param {number} code */
const entry = (code) => ({
  code,
  name: `Activity ${code}`,
  category: 'General',
  color: null,
  examples: null,
  isCustomInput: false,
  children: [],
  frequencyOptions: [],
  haystack: `activity ${code}`,
});

test('nothing used yet means no shortcut row', () => {
  assert.deepEqual(recentEntries(RECENT_ENTRIES, []), []);
  assert.deepEqual(recentEntries(RECENT_ENTRIES, null), []);
});

test('the most recently touched activity comes first', () => {
  const codes = recentEntries(RECENT_ENTRIES, [
    used(100, '2026-10-01T10:00:00+00:00'),
    used(101, '2026-10-02T10:00:00+00:00'),
  ]).map((item) => item.code);

  assert.deepEqual(codes, [101, 100]);
});

test('an activity used on several days counts once, at its latest use', () => {
  const codes = recentEntries(RECENT_ENTRIES, [
    used(100, '2026-10-01T10:00:00+00:00'),
    used(101, '2026-10-02T10:00:00+00:00'),
    used(100, '2026-10-03T10:00:00+00:00'),
  ]).map((item) => item.code);

  assert.deepEqual(codes, [100, 101]);
});

test('a sub-activity counts as the row the participant picked', () => {
  const codes = recentEntries(RECENT_ENTRIES, [
    { ...used(1021, '2026-10-02T10:00:00+00:00'), parent_activity_code: 102 },
  ]).map((item) => item.code);

  assert.deepEqual(codes, [102]);
});

test('the list is capped', () => {
  const entries = [1, 2, 3, 4, 5].map(entry);
  const activities = entries.map((item, index) =>
    used(item.code, `2026-10-0${index + 1}T10:00:00+00:00`)
  );

  assert.deepEqual(
    recentEntries(entries, activities).map((item) => item.code),
    [5, 4, 3, 2]
  );
  assert.deepEqual(
    recentEntries(entries, activities, { limit: 2 }).map((item) => item.code),
    [5, 4]
  );
});

test('codes no longer in the catalogue are skipped', () => {
  const codes = recentEntries(RECENT_ENTRIES, [
    used(4242, '2026-10-03T10:00:00+00:00'),
    used(100, '2026-10-01T10:00:00+00:00'),
  ]).map((item) => item.code);

  assert.deepEqual(codes, [100]);
});

test('a custom input is not a useful shortcut', () => {
  // The fixture's code 200 is "Paid work" with is_custom_input: true.
  const codes = recentEntries(RECENT_ENTRIES, [
    used(200, '2026-10-03T10:00:00+00:00'),
    used(100, '2026-10-01T10:00:00+00:00'),
  ]).map((item) => item.code);

  assert.deepEqual(codes, [100]);
});

test('order follows the instant, not the string', () => {
  // 09:00+02:00 is 07:00Z, so it is *older* than 08:00Z even though its string
  // sorts later.
  const codes = recentEntries(RECENT_ENTRIES, [
    used(100, '2026-10-01T09:00:00+02:00'),
    used(101, '2026-10-01T08:00:00+00:00'),
  ]).map((item) => item.code);

  assert.deepEqual(codes, [101, 100]);
});

test('the creation time is the fallback when nothing was edited', () => {
  const codes = recentEntries(RECENT_ENTRIES, [
    { activity_code: 100, created_at: '2026-10-01T10:00:00+00:00' },
    { activity_code: 101, created_at: '2026-10-02T10:00:00+00:00' },
  ]).map((item) => item.code);

  assert.deepEqual(codes, [101, 100]);
});
