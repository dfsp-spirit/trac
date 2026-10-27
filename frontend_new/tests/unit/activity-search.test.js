import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  filterEntries,
  flattenCatalogue,
  fold,
  groupByCategory,
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
