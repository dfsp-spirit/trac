import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  ALLOWED_TIME_STEPS,
  DEFAULT_DURATION_MINUTES,
  timingFor,
} from '../../src/js/domain/timing.js';

// The study's grid, resolved from the diary payload. The rules that matter:
// the historical 10/10 applies when nothing is configured, the default entry
// stays an hour even on a 20-minute grid, and a value that could not be saved
// (a minimum off the step) is repaired instead of locking the form.

test('missing settings fall back to the historical 10-minute grid', () => {
  assert.deepEqual(timingFor(null), { step: 10, minDuration: 10, defaultDuration: 60 });
  assert.deepEqual(timingFor({ study: {} }), { step: 10, minDuration: 10, defaultDuration: 60 });
});

test('a 5-minute step keeps a 10-minute minimum and an hour default', () => {
  assert.deepEqual(
    timingFor({ study: { time_step_minutes: 5, min_duration_minutes: 10 } }),
    { step: 5, minDuration: 10, defaultDuration: 60 }
  );
});

test('the default duration is rounded up to whole steps', () => {
  assert.equal(
    timingFor({ study: { time_step_minutes: 20, min_duration_minutes: 20 } }).defaultDuration,
    60
  );
  assert.equal(
    timingFor({ study: { time_step_minutes: 30, min_duration_minutes: 30 } }).defaultDuration,
    DEFAULT_DURATION_MINUTES
  );
});

test('the default duration never drops below the minimum', () => {
  assert.equal(
    timingFor({ study: { time_step_minutes: 20, min_duration_minutes: 120 } }).defaultDuration,
    120
  );
});

test('a minimum off the step is rounded up instead of breaking the form', () => {
  // The server rejects this configuration; should a row still hold it, an
  // on-grid start plus an off-grid end would be refused by the form itself.
  assert.equal(
    timingFor({ study: { time_step_minutes: 15, min_duration_minutes: 10 } }).minDuration,
    15
  );
});

test('nonsense values degrade to the default grid', () => {
  assert.deepEqual(
    timingFor({ study: { time_step_minutes: 7, min_duration_minutes: 0 } }),
    { step: 10, minDuration: 10, defaultDuration: 60 }
  );
});

test('the allowed steps are multiples of five that divide the day', () => {
  for (const step of ALLOWED_TIME_STEPS) {
    assert.equal(step % 5, 0, `${step} is a multiple of five`);
    assert.equal(1440 % step, 0, `${step} divides 1440`);
  }
});
