// Tests for the autosave engine.
//
// The timing rules are the whole point of this module, and they are the part a
// browser test can only probe indirectly (by counting requests and hoping). Here
// the clock and the save function are injected, so a burst of edits, a slow
// request, a failure and a retry are all deterministic.
//
// The rules, and why each matters:
//   - never two saves at once: overlapping snapshots can duplicate/blank rows
//   - never write an unchanged day: every save re-creates the rows, so a no-op
//     write also moves the day's created_at (diary_completed_at is derived from it)
//   - debounce: a drag/resize burst becomes one request
//   - flush(): anything that leaves the day must persist pending work first
import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  AUTOSAVE_DEBOUNCE_MS,
  AUTOSAVE_MAX_WAIT_MS,
  createAutosave,
} from '../../src/js/autosave.js';

/** Minimal fake clock: run every due timer when `advance` is called. */
function createFakeTimers() {
  let nextId = 1;
  let currentTime = 0;
  const timers = new Map();

  return {
    now: () => currentTime,
    setTimer(fn, ms) {
      const id = nextId++;
      timers.set(id, { at: currentTime + ms, fn });
      return id;
    },
    clearTimer(id) {
      timers.delete(id);
    },
    /** Fire everything scheduled within `ms`, in order. */
    async advance(ms) {
      const target = currentTime + ms;
      for (;;) {
        const due = [...timers.entries()]
          .filter(([, timer]) => timer.at <= target)
          .sort((a, b) => a[1].at - b[1].at);
        if (due.length === 0) break;
        const [id, timer] = due[0];
        timers.delete(id);
        currentTime = timer.at;
        timer.fn();
        await Promise.resolve(); // let any pending microtasks settle
      }
      currentTime = target;
    },
    pendingCount: () => timers.size,
  };
}

/** Autosave wired to a fake clock, a stubbed day and a recording save(). */
function createHarness({ saveResults = [], serialize } = {}) {
  const timers = createFakeTimers();
  const calls = [];
  const savedCallbacks = [];
  const states = [];
  let day = serialize ? serialize() : 'v1';

  const autosave = createAutosave({
    save: async () => {
      calls.push(day);
      const next = saveResults.shift();
      return next || { success: true };
    },
    serialize: () => (serialize ? serialize() : day),
    onSaved: () => savedCallbacks.push(day),
    onStateChange: (state) => states.push(state),
    now: timers.now,
    setTimer: timers.setTimer,
    clearTimer: timers.clearTimer,
    logger: { warn: () => {} },
  });

  return {
    autosave,
    timers,
    calls,
    savedCallbacks,
    states,
    setDay(value) {
      day = value;
    },
  };
}

test('the first observation only establishes the reference point', async () => {
  const harness = createHarness();
  harness.autosave.notePossibleChange();
  await harness.timers.advance(AUTOSAVE_MAX_WAIT_MS * 2);

  assert.deepEqual(harness.calls, [], 'loading a day must not write it back');
  assert.equal(harness.autosave.hasPendingChanges(), false);
});

test('an edit is saved once, after the debounce', async () => {
  const harness = createHarness();
  harness.autosave.notePossibleChange(); // baseline
  harness.setDay('v2');
  harness.autosave.notePossibleChange();

  assert.equal(harness.autosave.state(), 'pending');
  await harness.timers.advance(AUTOSAVE_DEBOUNCE_MS - 1);
  assert.deepEqual(harness.calls, [], 'nothing happens before the debounce elapses');

  await harness.timers.advance(1);
  assert.deepEqual(harness.calls, ['v2']);
  assert.equal(harness.autosave.state(), 'saved');
  assert.equal(harness.autosave.hasPendingChanges(), false);
});

test('a burst of edits collapses into a single request', async () => {
  const harness = createHarness();
  harness.autosave.notePossibleChange();

  for (let i = 2; i <= 6; i += 1) {
    harness.setDay(`v${i}`);
    harness.autosave.notePossibleChange();
    await harness.timers.advance(200); // faster than the debounce
  }
  await harness.timers.advance(AUTOSAVE_DEBOUNCE_MS);

  assert.deepEqual(harness.calls, ['v6'], 'the burst becomes one current snapshot');
});

test('continuous editing still saves within maxWaitMs', async () => {
  const harness = createHarness();
  harness.autosave.notePossibleChange();

  // Keep editing every 500ms: the debounce alone would never fire.
  for (let i = 2; i <= 40; i += 1) {
    harness.setDay(`v${i}`);
    harness.autosave.notePossibleChange();
    await harness.timers.advance(500);
    if (harness.calls.length > 0) break;
  }

  assert.equal(harness.calls.length, 1, 'the ceiling fires during a long edit burst');
  const elapsedToFirstSave = harness.calls.length > 0;
  assert.ok(elapsedToFirstSave);
  assert.ok(
    harness.timers.now() <= AUTOSAVE_MAX_WAIT_MS + 500,
    `first save must not wait longer than maxWaitMs (waited ${harness.timers.now()}ms)`
  );
});

test('changes arriving during a save are coalesced, never overlapped', async () => {
  const timers = createFakeTimers();
  let day = 'v1';
  let releaseFirstSave;
  const started = [];
  const finished = [];

  const autosave = createAutosave({
    save: async () => {
      started.push(day);
      if (started.length === 1) {
        // Hold the first request open until the test releases it.
        await new Promise((resolve) => {
          releaseFirstSave = resolve;
        });
      }
      finished.push(day);
      return { success: true };
    },
    serialize: () => day,
    now: timers.now,
    setTimer: timers.setTimer,
    clearTimer: timers.clearTimer,
    logger: { warn: () => {} },
  });

  autosave.notePossibleChange(); // baseline v1
  day = 'v2';
  autosave.notePossibleChange();
  await timers.advance(AUTOSAVE_DEBOUNCE_MS);
  assert.deepEqual(started, ['v2'], 'first save started');

  // Two more edits while that request is in flight.
  day = 'v3';
  autosave.notePossibleChange();
  day = 'v4';
  autosave.notePossibleChange();
  await timers.advance(AUTOSAVE_DEBOUNCE_MS * 3);

  assert.deepEqual(started, ['v2'], 'no second request while one is in flight');

  releaseFirstSave();
  await Promise.resolve();
  await Promise.resolve();
  await timers.advance(AUTOSAVE_DEBOUNCE_MS);

  assert.deepEqual(started, ['v2', 'v4'], 'the coalesced follow-up uses the latest day');
  assert.equal(finished.length, 2);
});

test('a failed save is retried with backoff and reports the error state', async () => {
  const harness = createHarness({
    saveResults: [{ success: false, error: 'boom' }, { success: true }],
  });
  harness.autosave.notePossibleChange(); // baseline
  harness.setDay('v2');
  harness.autosave.notePossibleChange();

  await harness.timers.advance(AUTOSAVE_DEBOUNCE_MS);
  assert.equal(harness.autosave.state(), 'error');
  assert.equal(harness.autosave.hasPendingChanges(), true, 'the change is still pending');
  assert.equal(harness.calls.length, 1);

  await harness.timers.advance(2000); // first retry delay
  assert.equal(harness.calls.length, 2, 'the retry went out');
  assert.equal(harness.autosave.state(), 'saved');
  assert.equal(harness.autosave.hasPendingChanges(), false);
});

test('a retry keeps the latest content, not the snapshot that failed', async () => {
  const harness = createHarness({
    saveResults: [{ success: false }, { success: true }],
  });
  harness.autosave.notePossibleChange();
  harness.setDay('v2');
  harness.autosave.notePossibleChange();
  await harness.timers.advance(AUTOSAVE_DEBOUNCE_MS);

  harness.setDay('v3'); // edited again while the retry is pending
  harness.autosave.notePossibleChange();
  await harness.timers.advance(2000);

  assert.deepEqual(harness.calls, ['v2', 'v3']);
});

test('flush saves pending changes and waits for them', async () => {
  const harness = createHarness();
  harness.autosave.notePossibleChange();
  harness.setDay('v2');
  harness.autosave.notePossibleChange();

  const result = await harness.autosave.flush();

  assert.deepEqual(result, { success: true, saved: true });
  assert.deepEqual(harness.calls, ['v2'], 'flush does not wait for the debounce');
  assert.equal(harness.autosave.hasPendingChanges(), false);
});

test('flush on an unchanged day does not write', async () => {
  const harness = createHarness();
  harness.autosave.notePossibleChange();

  const result = await harness.autosave.flush();

  assert.deepEqual(result, { success: true, saved: false });
  assert.deepEqual(harness.calls, []);
});

test('flush reports failure so callers can abort (day switch)', async () => {
  const harness = createHarness({ saveResults: [{ success: false, error: 'offline' }] });
  harness.autosave.notePossibleChange();
  harness.setDay('v2');
  harness.autosave.notePossibleChange();

  const result = await harness.autosave.flush();

  assert.equal(result.success, false);
  assert.equal(result.saved, true);
  assert.equal(harness.autosave.hasPendingChanges(), true, 'work is not lost');
});

test('markSaved records an explicit save so it is not written again', async () => {
  const harness = createHarness();
  harness.autosave.notePossibleChange();
  harness.setDay('v2');
  harness.autosave.notePossibleChange();

  // The Save Day button wrote this content itself.
  harness.autosave.markSaved();
  await harness.timers.advance(AUTOSAVE_MAX_WAIT_MS * 2);

  assert.deepEqual(harness.calls, [], 'no duplicate write after an explicit save');
  assert.equal(harness.autosave.state(), 'saved');
});

test('resetBaseline adopts a different day without writing it', async () => {
  const harness = createHarness();
  harness.autosave.notePossibleChange();
  harness.setDay('v2');
  harness.autosave.notePossibleChange();

  harness.setDay('other-day');
  harness.autosave.resetBaseline();
  await harness.timers.advance(AUTOSAVE_MAX_WAIT_MS * 2);

  assert.deepEqual(harness.calls, []);
  assert.equal(harness.autosave.hasPendingChanges(), false);
  assert.equal(harness.autosave.state(), 'idle');
});

test('dispose stops all timers', async () => {
  const harness = createHarness();
  harness.autosave.notePossibleChange();
  harness.setDay('v2');
  harness.autosave.notePossibleChange();

  harness.autosave.dispose();
  await harness.timers.advance(AUTOSAVE_MAX_WAIT_MS * 2);

  assert.deepEqual(harness.calls, []);
  assert.equal(harness.timers.pendingCount(), 0);
});
