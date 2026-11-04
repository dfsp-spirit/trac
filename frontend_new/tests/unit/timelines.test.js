import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  fallbackTimelineKey,
  generalTimelineSettings,
  normalizePolicy,
  selectTimelineKeys,
  timelineKeysFor,
} from '../../src/js/domain/timelines.js';

const oneTimeline = {
  timeline: {
    primary: { min_coverage: 600, max_overlap: 3, categories: [] },
  },
};

const twoTimelines = {
  timeline: {
    primary: { min_coverage: 600, max_overlap: 3, categories: [] },
    secondary: { min_coverage: 0, max_overlap: 2, categories: [] },
  },
};

test('an unknown policy falls back to ignore, which is the targeting state', () => {
  assert.equal(normalizePolicy('merge'), 'merge');
  assert.equal(normalizePolicy('error'), 'error');
  assert.equal(normalizePolicy('ignore'), 'ignore');
  assert.equal(normalizePolicy(undefined), 'ignore');
  assert.equal(normalizePolicy('nonsense'), 'ignore');
});

test('a single-timeline study runs under every policy', () => {
  for (const policy of ['ignore', 'merge', 'error']) {
    assert.deepEqual(selectTimelineKeys(oneTimeline, { policy }), {
      keys: ['primary'],
      error: null,
    });
  }
});

test('ignore keeps only the timeline the diary resolved to', () => {
  const { keys, error } = selectTimelineKeys(twoTimelines, {
    policy: 'ignore',
    timelineKey: 'primary',
  });

  assert.deepEqual(keys, ['primary']);
  assert.equal(error, null);
});

test('ignore falls back the way the backend resolves when no key is known', () => {
  assert.deepEqual(selectTimelineKeys(twoTimelines, { policy: 'ignore' }).keys, [
    'primary',
  ]);
  assert.deepEqual(
    selectTimelineKeys(
      { timeline: { first: {}, second: {} } },
      { policy: 'ignore' }
    ).keys,
    ['first']
  );
});

test('ignore ignores a resolved key the catalogue does not define', () => {
  assert.deepEqual(
    selectTimelineKeys(twoTimelines, { policy: 'ignore', timelineKey: 'gone' }).keys,
    ['primary']
  );
});

test('merge keeps every timeline in config order', () => {
  assert.deepEqual(selectTimelineKeys(twoTimelines, { policy: 'merge' }).keys, [
    'primary',
    'secondary',
  ]);
});

test('error refuses a study with more than one timeline', () => {
  assert.deepEqual(selectTimelineKeys(twoTimelines, { policy: 'error' }), {
    keys: [],
    error: 'multi_timeline',
  });
});

test('general settings come from the first timeline, not the last', () => {
  assert.deepEqual(generalTimelineSettings(twoTimelines, ['primary', 'secondary']), {
    minCoverage: 600,
    maxOverlap: 3,
  });
  assert.deepEqual(generalTimelineSettings(twoTimelines, ['secondary']), {
    minCoverage: 0,
    maxOverlap: 2,
  });
  assert.deepEqual(generalTimelineSettings(twoTimelines, []), {
    minCoverage: null,
    maxOverlap: null,
  });
});

test('fallbackTimelineKey prefers primary, then the first key', () => {
  assert.equal(fallbackTimelineKey(['secondary', 'primary']), 'primary');
  assert.equal(fallbackTimelineKey(['a', 'b']), 'a');
  assert.equal(fallbackTimelineKey([]), null);
});

test('timelineKeysFor reads the resolved key from the diary payload', () => {
  assert.deepEqual(
    timelineKeysFor(twoTimelines, { timeline: { key: 'secondary' } }, 'merge'),
    ['primary', 'secondary']
  );
  assert.deepEqual(
    timelineKeysFor(twoTimelines, { timeline: { key: 'secondary' } }, 'ignore'),
    ['secondary']
  );
  assert.deepEqual(timelineKeysFor(twoTimelines, null, 'ignore'), ['primary']);
  assert.deepEqual(timelineKeysFor(null, null, 'ignore'), []);
});
