import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  MINUTES_PER_DAY,
  STEP_MINUTES,
  clampMinutes,
  clockMinutes,
  dayOffset,
  formatClock,
  parseClock,
  resolveRangeEnd,
  snapMinutes,
} from '../../src/js/domain/time.js';

test('the app works in 10-minute steps (D24)', () => {
  assert.equal(STEP_MINUTES, 10);
  assert.equal(MINUTES_PER_DAY, 1440);
});

test('snapMinutes rounds, floors and ceils to the 10-minute step', () => {
  assert.equal(snapMinutes(14), 10);
  assert.equal(snapMinutes(16), 20);
  assert.equal(snapMinutes(16, { mode: 'floor' }), 10);
  assert.equal(snapMinutes(11, { mode: 'ceil' }), 20);
  assert.equal(snapMinutes(-30), 0);
  assert.equal(snapMinutes(5000, { max: 1430 }), 1430);
  assert.equal(snapMinutes(Number.NaN), 0);
});

test('clampMinutes keeps values inside the range and tolerates NaN', () => {
  assert.equal(clampMinutes(5, 0, 10), 5);
  assert.equal(clampMinutes(-1, 0, 10), 0);
  assert.equal(clampMinutes(11, 0, 10), 10);
  assert.equal(clampMinutes(Number.NaN, 3, 10), 3);
});

test('clock minutes and formatting follow the study day start', () => {
  assert.equal(clockMinutes(0, 0), 0);
  assert.equal(formatClock(0, 0), '00:00');
  assert.equal(formatClock(450, 0), '07:30');
  assert.equal(formatClock(1320, 0), '22:00');
  // A 04:00 study: day-relative 0 is 04:00 on the wall clock.
  assert.equal(formatClock(0, 240), '04:00');
  assert.equal(formatClock(120, 240), '06:00');
  assert.equal(formatClock(MINUTES_PER_DAY + 60, 0), '01:00');
  assert.equal(dayOffset(1439), 0);
  assert.equal(dayOffset(1440), 1);
  assert.equal(dayOffset(1920), 1);
});

test('parseClock reads a <input type="time"> value and refuses partial ones', () => {
  assert.equal(parseClock('00:00'), 0);
  assert.equal(parseClock('07:30'), 450);
  assert.equal(parseClock('23:50'), 1430);
  assert.equal(parseClock(' 09:05 '), 545);
  // A segmented field reports nothing between edits, and a half-typed value
  // must not be read as midnight.
  assert.equal(parseClock(''), null);
  assert.equal(parseClock('9:05'), null);
  assert.equal(parseClock('24:00'), null);
  assert.equal(parseClock('10:60'), null);
  assert.equal(parseClock(undefined), null);
});

test('resolveRangeEnd keeps the end on the same day when it is later', () => {
  // 10:00 -> 11:00
  assert.equal(resolveRangeEnd(600, 11 * 60), 660);
  // Picking the same clock means "until the same time tomorrow": a whole day is
  // a real entry, and the duration line makes it visible.
  assert.equal(resolveRangeEnd(0, 0), MINUTES_PER_DAY);
  assert.equal(resolveRangeEnd(600, 600), MINUTES_PER_DAY + 600);
});

test('resolveRangeEnd rolls past midnight when the clock is earlier', () => {
  // 22:00 -> 08:00 is one entry ending on the next day.
  assert.equal(resolveRangeEnd(1320, 8 * 60), MINUTES_PER_DAY + 480);
  // On the last day that end is capped at midnight.
  assert.equal(
    resolveRangeEnd(1320, 8 * 60, { isLastDay: true }),
    MINUTES_PER_DAY
  );
});

test('resolveRangeEnd uses the study day start for the clock conversion', () => {
  // A 04:00 study: wall clock 06:00 is day-relative 02:00, so 01:00 -> 06:00
  // stays on the same diary day.
  assert.equal(resolveRangeEnd(60, 6 * 60, { dayStartMinutes: 240 }), 120);
  // ...and 02:00 on the wall clock belongs to the end of the diary day, so it
  // is the next one relative to a start at 20:00.
  assert.equal(resolveRangeEnd(1200, 2 * 60, { dayStartMinutes: 240 }), 1320);
});
