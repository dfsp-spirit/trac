import { test } from 'node:test';
import assert from 'node:assert/strict';
import { formatStudyDate } from '../../src/js/domain/dates.js';

// The collection window is the only real date in the participant UI (D39). It is
// formatted in UTC on purpose: the window is a study-administrative boundary, and
// a window ending at 23:59:59Z must not read "1 February" for a participant east
// of UTC. These tests therefore assert the UTC date, not the machine's.

test('formats the window in the study language', () => {
  assert.equal(formatStudyDate('2026-06-01T00:00:00Z', 'de'), '1. Juni 2026');
  assert.equal(formatStudyDate('2026-06-01T00:00:00Z', 'en'), 'June 1, 2026');
  assert.equal(formatStudyDate('2026-06-01T00:00:00Z', 'sv'), '1 juni 2026');
});

test('a late-evening UTC timestamp keeps its UTC date', () => {
  assert.equal(formatStudyDate('2025-01-31T23:59:59Z', 'de'), '31. Januar 2025');
});

test('nothing to format renders as an empty string', () => {
  assert.equal(formatStudyDate(null, 'de'), '');
  assert.equal(formatStudyDate('', 'de'), '');
  assert.equal(formatStudyDate('not-a-date', 'de'), '');
});

test('an unknown language falls back to English instead of ISO', () => {
  assert.equal(formatStudyDate('2026-06-01T00:00:00Z', 'xx-bogus'), 'June 1, 2026');
});
