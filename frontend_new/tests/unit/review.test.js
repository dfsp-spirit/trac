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

/** @param {string} id @param {number} day @param {number} start @param {number} end */
function entry(id, day, start, end) {
  return {
    client_uuid: id,
    day_label_index: day,
    activity_code: 1,
    activity_name: 'Working',
    category: 'Work',
    color: null,
    start_minutes: start,
    end_minutes: end,
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

test('a day exposes its covered stretches for the strip', () => {
  const model = review(diary(), 'en');
  assert.deepEqual(model.days[0].runs, [{ start: 480, end: 720 }]);
  assert.deepEqual(model.days[1].runs, []);
  // 22:00-01:00 is clipped at midnight; its tail would belong to a fourth day.
  assert.deepEqual(model.days[2].runs, [{ start: 1320, end: 1440 }]);
});

test('touching and overlapping entries become one stretch', () => {
  const model = review(
    diary({
      activities: [
        entry('a', 0, 540, 600),
        entry('b', 0, 600, 660),
        entry('c', 0, 570, 630),
      ],
    }),
    'en'
  );
  assert.deepEqual(model.days[0].runs, [{ start: 540, end: 660 }]);
});

test('the largest hole includes the empty morning and evening', () => {
  // One entry 09:00-10:00: the empty evening (14h) beats the empty morning (9h).
  const model = review(
    diary({ activities: [entry('a', 0, 540, 600)], minCoverage: 1440 }),
    'en'
  );
  assert.deepEqual(model.days[0].largestGap, { start: 600, end: 1440 });
});

test('the largest hole is the longest one, not the first one', () => {
  // 00:00-01:00 and 10:00-11:00: holes of 9h and 13h, so the evening wins.
  const model = review(
    diary({
      activities: [entry('a', 0, 0, 60), entry('b', 0, 600, 660)],
      minCoverage: 1440,
    }),
    'en'
  );
  assert.deepEqual(model.days[0].largestGap, { start: 660, end: 1440 });
});

test('a hole shorter than a gap is not pointed at', () => {
  // Ten minutes left, and the day is still short of its requirement.
  const model = review(
    diary({ activities: [entry('a', 0, 0, 1430)], minCoverage: 1440 }),
    'en'
  );
  assert.equal(model.days[0].meets, false);
  assert.equal(model.days[0].largestGap, null);
});

test('a complete day and an empty day have no hole to point at', () => {
  const model = review(diary(), 'en');
  assert.equal(model.days[0].meets, true);
  assert.equal(model.days[0].largestGap, null, 'nothing to fix');
  assert.equal(model.days[1].largestGap, null, 'an empty day says so in words');
});

test('an entry that ends at midnight does not reach into the next day', () => {
  const model = review(diary({ activities: [entry('a', 0, 1320, 1440)] }), 'en');
  assert.deepEqual(model.days[0].runs, [{ start: 1320, end: 1440 }]);
  assert.deepEqual(model.days[1].runs, []);
});

test('the night before shows up on the day it reaches into', () => {
  const model = review(diary({ activities: [entry('a', 0, 1380, 1500)] }), 'en');
  assert.deepEqual(model.days[1].runs, [{ start: 0, end: 60 }]);
});

test('a shifted day window decides whether a night crosses the boundary', () => {
  const midnight = review(diary(), 'en');
  assert.deepEqual(midnight.days[2].runs, [{ start: 1320, end: 1440 }]);
  const shifted = review(diary({ dayStart: 240 }), 'en');
  assert.deepEqual(shifted.days[2].runs, [{ start: 1080, end: 1260 }]);
});

test('minutes still to add never goes negative, and is 0 when complete', () => {
  const model = review(diary({ minCoverage: 300 }), 'en');
  assert.equal(model.days[0].minutesToGo, 60, '240 covered of 300 required');
  assert.equal(model.days[1].minutesToGo, 300);
  assert.equal(review(diary(), 'en').days[0].minutesToGo, 0);
});

test('a day label follows the interface language, with a fallback', () => {
  assert.equal(review(diary(), 'de').days[0].label, 'Montag');
  assert.equal(review(diary(), 'en').days[0].label, 'Monday');
  assert.equal(review(diary(), 'sv').days[0].label, 'Monday', 'no Swedish label, so the study default');
});

test('an empty study has nothing to submit', () => {
  const model = review({ ...diary({ activities: [] }) }, 'en');
  assert.equal(model.canSubmit, false, 'no days met, so no submission');
  assert.equal(model.days[0].runs.length, 0);
  assert.equal(model.days[0].largestGap, null);
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
