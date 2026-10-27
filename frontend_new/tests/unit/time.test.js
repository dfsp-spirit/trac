import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  MINUTES_PER_DAY,
  STEP_MINUTES,
  clampMinutes,
  clockMinutes,
  dayOffset,
  formatClock,
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
