import { test } from 'node:test';
import assert from 'node:assert/strict';
import { review } from '../../src/js/domain/review.js';
import { toCreateItem } from '../../src/js/domain/diary.js';

/**
 * A three-day diary on a midnight window: day 0 has 08:00-12:00 (complete),
 * day 1 is empty, day 2 has 22:00-01:00, which runs past midnight.
 *
 * @param {Partial<{ minCoverage: number | null, dayStart: number, activities: any[] }>} [overrides]
 * @returns {any}
 */
function diary(overrides = {}) {
  const dayStart = overrides.dayStart ?? 0;
  const activities = overrides.activities ?? [
    {
      client_uuid: 'a0:0',
      day_label_index: 0,
      activity_code: 1,
      activity_name: 'Sleeping',
      category: 'Personal',
      color: null,
      start_minutes: 480,
      end_minutes: 720,
    },
    {
      client_uuid: 'a2:2',
      day_label_index: 2,
      activity_code: 2,
      activity_name: 'Working',
      category: 'Work',
      color: '#3366cc',
      start_minutes: 1320,
      end_minutes: 1500,
    },
  ];
  return {
    schema_version: 1,
    study: { day_start_minutes: dayStart, submitted_at: null },
    timeline: { min_coverage: overrides.minCoverage ?? 60, max_overlap: 2 },
    days: [0, 1, 2].map((index) => ({
      index,
      name: ['mon', 'tue', 'wed'][index],
      display_name: ['Monday', 'Tuesday', 'Wednesday'][index],
      display_names: { de: ['Montag', 'Dienstag', 'Mittwoch'][index] },
      has_data: false,
      coverage_minutes: 0,
      meets_requirement: false,
    })),
    activities,
  };
}

test('a day is complete when its union of minutes reaches the requirement', () => {
  const model = review(diary(), 'en');
  assert.deepEqual(
    model.days.map((day) => day.meets),
    [true, false, true],
    'day 0 has 240 minutes, day 1 is empty, day 2 covers 22:00 to midnight'
  );
});

test('incomplete days are listed in day order, with the complete count', () => {
  const model = review(diary(), 'en');
  assert.deepEqual(model.incomplete, [1]);
  assert.deepEqual(model.incompleteLabels, ['Tuesday']);
  assert.equal(model.completeDays, 2);
  assert.equal(model.totalDays, 3);
  assert.equal(model.canSubmit, false);
});

test('a fully covered diary can be submitted', () => {
  const activities = [0, 1, 2].map((index) => ({
    client_uuid: `x:${index}`,
    day_label_index: index,
    activity_code: 1,
    activity_name: 'Working',
    category: 'Work',
    color: null,
    start_minutes: 540,
    end_minutes: 720,
  }));
  const model = review(diary({ activities }), 'en');
  assert.equal(model.canSubmit, true);
  assert.deepEqual(model.incomplete, []);
  assert.equal(model.completeDays, 3);
});

test('rows are in time order and carry the activity, not the segment', () => {
  const model = review(
    diary({
      activities: [
        {
          client_uuid: 'late:0',
          day_label_index: 0,
          activity_code: 2,
          activity_name: 'Reading',
          category: 'Leisure',
          color: null,
          start_minutes: 1200,
          end_minutes: 1320,
        },
        {
          client_uuid: 'early:0',
          day_label_index: 0,
          activity_code: 1,
          activity_name: 'Working',
          category: 'Work',
          color: '#3366cc',
          start_minutes: 540,
          end_minutes: 720,
        },
      ],
    }),
    'en'
  );
  const rows = model.days[0].rows;
  assert.deepEqual(
    rows.map((row) => row.name),
    ['Working', 'Reading']
  );
  assert.equal(rows[0].color, '#3366cc');
});

test('an activity that runs past midnight is one row, flagged, on its own day', () => {
  const model = review(diary(), 'en');
  const rows = model.days[2].rows;
  assert.equal(rows.length, 1, 'the tail belongs to day 2, it is not a row of its own');
  assert.equal(rows[0].nextDay, true);
  assert.equal(rows[0].start, 1320, '22:00 on a midnight day');
  assert.equal(rows[0].end, 1500, 'past 1440, so the clock wraps to 01:00');
  assert.deepEqual(model.days[0].rows.map((row) => row.nextDay), [false]);
});

test('minutes still to add never goes negative, and is 0 when complete', () => {
  const model = review(diary({ minCoverage: 300 }), 'en');
  assert.equal(model.days[0].minutesToGo, 60, '240 covered of 300 required');
  assert.equal(model.days[1].minutesToGo, 300);
  assert.equal(review(diary(), 'en').days[0].minutesToGo, 0);
});

test('a shifted day window decides whether a night crosses the boundary', () => {
  const midnight = review(diary(), 'en').days[2].rows[0];
  assert.equal(midnight.nextDay, true, '22:00 to 01:00 crosses midnight');
  const shifted = review(diary({ dayStart: 240 }), 'en').days[2].rows[0];
  assert.equal(shifted.nextDay, false, 'inside a 04:00 day it is 22:00 to 23:00');
  assert.equal(shifted.start, 1080);
  assert.equal(shifted.end, 1260);
});

test('a day label follows the interface language, with a fallback', () => {
  assert.equal(review(diary(), 'de').days[0].label, 'Montag');
  assert.equal(review(diary(), 'en').days[0].label, 'Monday');
  assert.equal(review(diary(), 'sv').days[0].label, 'Monday', 'no Swedish label, so the study default');
});

test('a duplicate category is not repeated as a second line', () => {
  const withDetail = review(diary(), 'en').days[2].rows[0];
  assert.equal(withDetail.detail, 'Work');
  const same = review(
    diary({
      activities: [
        {
          client_uuid: 'x:0',
          day_label_index: 0,
          activity_code: 1,
          activity_name: 'Sleeping',
          category: 'Sleeping',
          color: null,
          start_minutes: 480,
          end_minutes: 720,
        },
      ],
    }),
    'en'
  ).days[0].rows[0];
  assert.equal(same.detail, null);
});

test('an empty study has nothing to submit', () => {
  const model = review({ ...diary({ activities: [] }) }, 'en');
  assert.equal(model.canSubmit, false, 'no days met, so no submission');
  assert.equal(model.days[0].rows.length, 0);
});

test('the undo payload rebuilds the row as it was, under a new client id', () => {
  const activity = diary().activities[0];
  const item = toCreateItem(activity, 'fresh-uuid');
  assert.deepEqual(item, {
    client_uuid: 'fresh-uuid',
    activity_code: 1,
    activity_name: 'Sleeping',
    category: 'Personal',
    color: null,
    parent_activity_code: undefined,
    frequency_key: undefined,
    start_minutes: 480,
    end_minutes: 720,
    day_label_indexes: [0],
  });
});
