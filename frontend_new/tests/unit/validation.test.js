import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  Codes,
  DEFAULT_MAX_OVERLAP,
  absoluteEnd,
  absoluteStart,
  isDuplicate,
  overlapViolation,
  planMultiDayCreate,
  validateActivity,
  validateTimeRange,
} from '../../src/js/domain/validation.js';

/** @param {Partial<{ id: string, dayIndex: number, startMinutes: number, endMinutes: number, activityCode: string }>} overrides */
function rec(overrides = {}) {
  return {
    id: 'a',
    dayIndex: 0,
    startMinutes: 0,
    endMinutes: 60,
    activityCode: 'sleep',
    ...overrides,
  };
}

test('validateTimeRange accepts a normal range on the step grid', () => {
  assert.deepEqual(validateTimeRange({ startMinutes: 480, endMinutes: 540 }), { ok: true });
  assert.deepEqual(validateTimeRange({ startMinutes: 0, endMinutes: 1440 }), { ok: true });
  assert.deepEqual(validateTimeRange({ startMinutes: 1320, endMinutes: 1920 }), { ok: true });
});

test('validateTimeRange rejects an end that is not after the start', () => {
  const result = validateTimeRange({ startMinutes: 600, endMinutes: 600 });
  assert.equal(result.ok, false);
  assert.equal(result.code, Codes.END_NOT_AFTER_START);
});

test('validateTimeRange rejects more than 24 hours', () => {
  const result = validateTimeRange({ startMinutes: 0, endMinutes: 1450 });
  assert.equal(result.code, Codes.TOO_LONG);
});

test('validateTimeRange rejects a start outside its own day', () => {
  assert.equal(validateTimeRange({ startMinutes: -10, endMinutes: 60 }).code, Codes.START_OUT_OF_RANGE);
  assert.equal(validateTimeRange({ startMinutes: 1440, endMinutes: 1500 }).code, Codes.START_OUT_OF_RANGE);
});

test('validateTimeRange rejects times off the 10-minute grid', () => {
  assert.equal(validateTimeRange({ startMinutes: 5, endMinutes: 60 }).code, Codes.NOT_ON_STEP);
  assert.equal(validateTimeRange({ startMinutes: 0, endMinutes: 65 }).code, Codes.NOT_ON_STEP);
});

test('validateTimeRange rejects non-numeric input instead of coercing it', () => {
  assert.equal(validateTimeRange({ startMinutes: Number.NaN, endMinutes: 60 }).code, Codes.END_NOT_AFTER_START);
});

test('absoluteStart and absoluteEnd place records on a study-wide axis', () => {
  assert.equal(absoluteStart(rec({ dayIndex: 2, startMinutes: 600 })), 2 * 1440 + 600);
  assert.equal(absoluteEnd(rec({ dayIndex: 2, endMinutes: 1920 })), 2 * 1440 + 1920);
});

test('the overlap limit defaults to two (PI answer to Q1)', () => {
  assert.equal(DEFAULT_MAX_OVERLAP, 2);
});

test('two parallel activities are allowed, a third is not', () => {
  const existing = [
    rec({ id: 'a', startMinutes: 480, endMinutes: 600 }),
    rec({ id: 'b', startMinutes: 480, endMinutes: 600 }),
  ];
  const candidate = rec({ id: 'c', startMinutes: 480, endMinutes: 600 });
  const result = overlapViolation({ candidate, existing });
  assert.equal(result.ok, false);
  assert.equal(result.code, Codes.OVERLAP_LIMIT);
  assert.equal(result.meta?.count, 3);
  assert.equal(result.meta?.minutesSinceDayStart, 480);
});

test('an overlap limit of one allows back-to-back activities', () => {
  const existing = [rec({ id: 'a', startMinutes: 480, endMinutes: 540 })];
  assert.deepEqual(
    overlapViolation({
      candidate: rec({ id: 'b', startMinutes: 540, endMinutes: 600 }),
      existing,
      maxOverlap: 1,
    }),
    { ok: true }
  );
});

test('editing a record does not count the record against itself', () => {
  const existing = [
    rec({ id: 'a', startMinutes: 480, endMinutes: 600 }),
    rec({ id: 'b', startMinutes: 480, endMinutes: 600 }),
  ];
  const result = overlapViolation({
    candidate: rec({ id: 'a', startMinutes: 480, endMinutes: 600 }),
    existing,
    ignoreId: 'a',
  });
  assert.deepEqual(result, { ok: true });
});

test('the tail of a cross-midnight activity counts on the following day', () => {
  const sleeping = rec({ id: 'night', dayIndex: 0, startMinutes: 1320, endMinutes: 1920 });
  const existing = [
    rec({ id: 'x', dayIndex: 1, startMinutes: 60, endMinutes: 120 }),
    rec({ id: 'y', dayIndex: 1, startMinutes: 60, endMinutes: 120 }),
  ];
  const candidate = rec({ id: 'z', dayIndex: 1, startMinutes: 60, endMinutes: 120 });
  const result = overlapViolation({ candidate, existing: [...existing, sleeping] });
  assert.equal(result.code, Codes.OVERLAP_LIMIT);
  assert.equal(result.meta?.dayIndex, 1);
});

test('isDuplicate matches activity, day and both times only', () => {
  const existing = [rec({ id: 'a', startMinutes: 480, endMinutes: 540, activityCode: 'sleep' })];
  assert.equal(
    isDuplicate({ candidate: rec({ id: 'b', startMinutes: 480, endMinutes: 540 }), existing }),
    true
  );
  assert.equal(
    isDuplicate({ candidate: rec({ id: 'b', startMinutes: 480, endMinutes: 540, activityCode: 'work' }), existing }),
    false
  );
  assert.equal(isDuplicate({ candidate: rec({ id: 'b', startMinutes: 490, endMinutes: 540 }), existing }), false);
  assert.equal(isDuplicate({ candidate: rec({ id: 'b', startMinutes: 480, endMinutes: 540, dayIndex: 1 }), existing }), false);
  assert.equal(
    isDuplicate({ candidate: rec({ id: 'b', startMinutes: 480, endMinutes: 540 }), existing, ignoreId: 'a' }),
    false
  );
});

test('validateActivity rejects a record that would run into the last midnight', () => {
  const result = validateActivity({
    candidate: rec({ dayIndex: 6, startMinutes: 1320, endMinutes: 1920 }),
    existing: [],
    dayCount: 7,
  });
  assert.equal(result.ok, false);
  assert.equal(result.code, Codes.LAST_DAY_MIDNIGHT);
});

test('validateActivity allows the same range on a day that is not the last', () => {
  const result = validateActivity({
    candidate: rec({ dayIndex: 5, startMinutes: 1320, endMinutes: 1920 }),
    existing: [],
    dayCount: 7,
  });
  assert.deepEqual(result, { ok: true });
});

test('validateActivity reports a day outside the study', () => {
  assert.equal(
    validateActivity({ candidate: rec({ dayIndex: -1 }), existing: [], dayCount: 7 }).code,
    Codes.DAY_OUT_OF_RANGE
  );
  assert.equal(
    validateActivity({ candidate: rec({ dayIndex: 7 }), existing: [], dayCount: 7 }).code,
    Codes.DAY_OUT_OF_RANGE
  );
});

test('validateActivity reports duplicates before overlaps', () => {
  const existing = [rec({ id: 'a', startMinutes: 480, endMinutes: 540 })];
  const result = validateActivity({
    candidate: rec({ id: 'b', startMinutes: 480, endMinutes: 540 }),
    existing,
    dayCount: 7,
  });
  assert.equal(result.code, Codes.DUPLICATE);
});

test('planMultiDayCreate adds the activity to every requested day', () => {
  const results = planMultiDayCreate({
    candidate: rec({ startMinutes: 480, endMinutes: 540 }),
    targets: [0, 1, 2],
    dayCount: 7,
    existing: [],
  });
  assert.deepEqual(results, [
    { dayIndex: 0, status: 'added' },
    { dayIndex: 1, status: 'added' },
    { dayIndex: 2, status: 'added' },
  ]);
});

test('planMultiDayCreate always includes the source day and ignores repeats', () => {
  const results = planMultiDayCreate({
    candidate: rec({ dayIndex: 3, startMinutes: 480, endMinutes: 540 }),
    targets: [3, 4, 4],
    dayCount: 7,
    existing: [],
  });
  assert.deepEqual(
    results.map((result) => result.dayIndex),
    [3, 4]
  );
});

test('planMultiDayCreate skips a target whose slot is already full', () => {
  const full = [
    rec({ id: 'x', dayIndex: 1, startMinutes: 480, endMinutes: 540, activityCode: 'work' }),
    rec({ id: 'y', dayIndex: 1, startMinutes: 480, endMinutes: 540, activityCode: 'care' }),
  ];
  const results = planMultiDayCreate({
    candidate: rec({ startMinutes: 480, endMinutes: 540 }),
    targets: [0, 1],
    dayCount: 7,
    existing: full,
  });
  assert.deepEqual(results, [
    { dayIndex: 0, status: 'added' },
    { dayIndex: 1, status: 'skipped', code: Codes.OVERLAP_LIMIT },
  ]);
});

test('planMultiDayCreate skips a cross-midnight record on the last day', () => {
  const results = planMultiDayCreate({
    candidate: rec({ dayIndex: 6, startMinutes: 1320, endMinutes: 1920 }),
    targets: [5],
    dayCount: 7,
    existing: [],
  });
  assert.deepEqual(results, [
    { dayIndex: 5, status: 'added' },
    { dayIndex: 6, status: 'skipped', code: Codes.LAST_DAY_MIDNIGHT },
  ]);
});

test('planMultiDayCreate skips days outside the study', () => {
  const results = planMultiDayCreate({
    candidate: rec(),
    targets: [0, 9],
    dayCount: 7,
    existing: [],
  });
  assert.deepEqual(results, [
    { dayIndex: 0, status: 'added' },
    { dayIndex: 9, status: 'skipped', code: Codes.DAY_OUT_OF_RANGE },
  ]);
});

test('planMultiDayCreate skips a duplicate on one target day only', () => {
  const results = planMultiDayCreate({
    candidate: rec({ startMinutes: 480, endMinutes: 540 }),
    targets: [0, 1],
    dayCount: 7,
    existing: [rec({ id: 'existing', dayIndex: 1, startMinutes: 480, endMinutes: 540 })],
  });
  assert.deepEqual(results, [
    { dayIndex: 0, status: 'added' },
    { dayIndex: 1, status: 'skipped', code: Codes.DUPLICATE },
  ]);
});

test('planMultiDayCreate rejects a night whose tail would overfill the next morning', () => {
  const results = planMultiDayCreate({
    candidate: rec({ dayIndex: 0, startMinutes: 1320, endMinutes: 1920 }),
    targets: [1],
    dayCount: 7,
    existing: [
      rec({ id: 'x', dayIndex: 1, startMinutes: 60, endMinutes: 120, activityCode: 'work' }),
      rec({ id: 'y', dayIndex: 1, startMinutes: 60, endMinutes: 120, activityCode: 'care' }),
    ],
  });
  assert.deepEqual(results, [
    { dayIndex: 0, status: 'skipped', code: Codes.OVERLAP_LIMIT },
    { dayIndex: 1, status: 'added' },
  ]);
});

test('the overlap error names the day and minute of the conflict', () => {
  const result = overlapViolation({
    candidate: rec({ id: 'night', dayIndex: 0, startMinutes: 1320, endMinutes: 1920 }),
    existing: [
      rec({ id: 'x', dayIndex: 1, startMinutes: 60, endMinutes: 120, activityCode: 'work' }),
      rec({ id: 'y', dayIndex: 1, startMinutes: 60, endMinutes: 120, activityCode: 'care' }),
    ],
  });
  assert.equal(result.ok, false);
  assert.equal(result.meta?.dayIndex, 1);
  assert.equal(result.meta?.minutesSinceDayStart, 60);
});
