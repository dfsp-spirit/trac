import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  SKIP_REASON_CODES,
  canSkipDiary,
  skipConsequences,
} from '../../src/js/domain/skip.js';

// Skipping the diary (D41) is opt-in per study and only exists on the diary
// stage. What the confirmation may promise about the remaining tasks has to
// match what the server enforces, so both come from the same config values.

const SESSION = {
  stage: 'diary',
  allow_skip_timeuse: true,
  require_diary_before_external_tasks: false,
  external_tasks: [],
};

test('the option exists only when the study asks for it', () => {
  assert.equal(canSkipDiary(SESSION), true);
  assert.equal(canSkipDiary({ ...SESSION, allow_skip_timeuse: false }), false);
  assert.equal(canSkipDiary({ ...SESSION, allow_skip_timeuse: undefined }), false);
  assert.equal(canSkipDiary(null), false);
});

test('the option exists only on the diary stage', () => {
  for (const stage of ['consent', 'instructions', 'tasks', 'done', 'unavailable']) {
    assert.equal(canSkipDiary({ ...SESSION, stage }), false, stage);
  }
});

test('a locked diary cannot be skipped', () => {
  assert.equal(canSkipDiary(SESSION, { locked: true }), false);
});

test('with nothing left to do the dialog promises nothing about tasks', () => {
  assert.deepEqual(skipConsequences(SESSION), { tasksContinue: false, tasksLocked: false });
});

test('tasks stay reachable when the study does not require the diary first', () => {
  const session = { ...SESSION, external_tasks: [{ is_confirmed: false }] };
  assert.deepEqual(skipConsequences(session), { tasksContinue: true, tasksLocked: false });
});

test('tasks stay closed when the study requires the diary before them', () => {
  // This is the configuration the server refuses to bypass: skipping is not a
  // filled diary, so the dialog must not promise the opposite.
  const session = {
    ...SESSION,
    require_diary_before_external_tasks: true,
    external_tasks: [{ is_confirmed: false }],
  };
  assert.deepEqual(skipConsequences(session), { tasksContinue: false, tasksLocked: true });
});

test('already-confirmed tasks are not "remaining"', () => {
  const session = {
    ...SESSION,
    require_diary_before_external_tasks: false,
    external_tasks: [{ is_confirmed: true }, { is_confirmed: true }],
  };
  assert.deepEqual(skipConsequences(session), { tasksContinue: false, tasksLocked: false });
});

test('the reason codes are the ones the server accepts', () => {
  assert.deepEqual(
    SKIP_REASON_CODES.map((entry) => entry.id),
    [
      'no_time_and_effort',
      'technical_problem',
      'did_not_understand',
      'do_not_want_to_report',
      'other',
    ]
  );
  for (const entry of SKIP_REASON_CODES) {
    assert.match(entry.key, /^diary\.skip\./);
  }
});
