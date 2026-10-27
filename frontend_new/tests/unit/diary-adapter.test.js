import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  daySummaries,
  layoutForDay,
  meetsRequirement,
  progress,
  timedActivities,
  toTimedActivity,
} from '../../src/js/domain/diary.js';

/** @param {Partial<any>} overrides */
function activity(overrides = {}) {
  return {
    client_uuid: 'a',
    group_id: null,
    day_label_index: 0,
    activity_code: 100,
    activity_name: 'Sleeping',
    category: 'General',
    color: null,
    parent_activity_code: null,
    frequency_key: null,
    start_minutes: 0,
    end_minutes: 60,
    ...overrides,
  };
}

/** @param {any[]} activities */
function diary(activities, { days = 2, dayStart = 0, minCoverage = null } = {}) {
  return {
    schema_version: 1,
    study: { day_start_minutes: dayStart, submitted_at: null },
    timeline: { min_coverage: minCoverage, max_overlap: 2 },
    days: Array.from({ length: days }, (_, index) => ({
      index,
      name: ['monday', 'tuesday'][index] || `day-${index}`,
      display_name: ['Monday', 'Tuesday'][index] || `Day ${index}`,
      display_names: { en: ['Monday', 'Tuesday'][index] || `Day ${index}` },
      has_data: false,
      coverage_minutes: 0,
      meets_requirement: false,
    })),
    activities,
  };
}

test('time is converted from clock minutes to day-relative minutes', () => {
  const converted = toTimedActivity(activity({ start_minutes: 0, end_minutes: 1440 }), 240);
  assert.equal(converted.startMinutes, 1200, '00:00 is 20 hours into a 04:00 day');
  assert.equal(converted.endMinutes, 2640, 'a full day keeps its length');
});

test('a cross-midnight record keeps its duration when converted', () => {
  const converted = toTimedActivity(activity({ start_minutes: 1320, end_minutes: 1920 }), 240);
  assert.equal(converted.endMinutes - converted.startMinutes, 600);
});

test('every activity becomes a timed record with its row id', () => {
  const records = timedActivities(diary([activity({ client_uuid: 'x' })]));
  assert.deepEqual(records, [{ id: 'x', dayIndex: 0, startMinutes: 0, endMinutes: 60 }]);
});

test('layoutForDay clips a cross-midnight activity into both days', () => {
  const model = diary([activity({ start_minutes: 1320, end_minutes: 1920 })]);
  assert.equal(layoutForDay(model, 0).coverage, 120);
  assert.equal(layoutForDay(model, 1).coverage, 480);
});

test('a requirement is only met when the day has data', () => {
  assert.equal(meetsRequirement({ coverage: 0, hasData: false }, 0), false);
  assert.equal(meetsRequirement({ coverage: 60, hasData: true }, 0), true);
  assert.equal(meetsRequirement({ coverage: 60, hasData: true }, 120), false);
  assert.equal(meetsRequirement({ coverage: 120, hasData: true }, 120), true);
});

test('day summaries are computed locally, not taken from the payload', () => {
  const model = diary([activity({ start_minutes: 0, end_minutes: 120 })]);
  model.days[0].coverage_minutes = 9999;
  const [first, second] = daySummaries(model);
  assert.equal(first.coverage, 120);
  assert.equal(first.hasData, true);
  assert.equal(second.coverage, 0);
  assert.equal(second.hasData, false);
});

test('progress counts the days that meet their requirement', () => {
  const model = diary(
    [
      activity({ client_uuid: 'a', day_label_index: 0, start_minutes: 0, end_minutes: 600 }),
      activity({ client_uuid: 'b', day_label_index: 1, start_minutes: 0, end_minutes: 60 }),
    ],
    { minCoverage: 600 }
  );
  assert.deepEqual(progress(model), { done: 1, total: 2 });
});
