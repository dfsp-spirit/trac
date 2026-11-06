import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  dayLabel,
  dayLabelList,
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

test('a day is named in the interface language, whichever shape it arrives in', () => {
  // The API row (snake_case) and a `daySummaries()` entry (camelCase) must read
  // the same, or one screen is left in the study's default language.
  const apiRow = {
    name: 'monday',
    display_name: 'Montag',
    display_names: { de: 'Montag', en: 'Monday' },
  };
  const summary = { name: 'monday', displayName: 'Montag', displayNames: { en: 'Monday' } };

  assert.equal(dayLabel(apiRow, 'de'), 'Montag');
  assert.equal(dayLabel(apiRow, 'en'), 'Monday');
  assert.equal(dayLabel(summary, 'en'), 'Monday');
  assert.equal(dayLabel(summary, 'de'), 'Montag');
});

test('a missing translation falls back to the study default, then the internal name', () => {
  assert.equal(dayLabel({ name: 'monday', display_name: 'Montag' }, 'sv'), 'Montag');
  assert.equal(dayLabel({ name: 'monday' }, 'en'), 'monday');
  assert.equal(dayLabel({ name: 'monday', displayNames: {} }, 'de'), 'monday');
});

test('dayLabelList names several days in order, without repeats', () => {
  const days = [
    { index: 0, name: 'monday', displayNames: { de: 'Montag', en: 'Monday' } },
    { index: 1, name: 'tuesday', displayNames: { de: 'Dienstag', en: 'Tuesday' } },
    { index: 2, name: 'wednesday', displayNames: { de: 'Mittwoch', en: 'Wednesday' } },
  ];
  assert.equal(dayLabelList([2, 0, 2], days, 'de'), 'Montag, Mittwoch');
  assert.equal(dayLabelList([1], days, 'en'), 'Tuesday');
  assert.equal(dayLabelList([], days, 'de'), '');
});

test('dayLabelList falls back to the index for a day the study does not have', () => {
  assert.equal(dayLabelList([0, 9], [{ index: 0, name: 'monday', display_name: 'Montag' }], 'de'), 'Montag, 9');
});
