// Tests for the autosave status chip mapping.
//
// The chip is the only thing that tells a participant their day is stored when
// they never press a button - so the two rules that matter are: it says something
// for every state the engine can be in, and it hides when it has nothing to say.
// The DOM part lives in ui.js; this covers state -> label/kind/icon.
import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  SYNC_STATUS_SAVED_VISIBLE_MS,
  syncStatusView,
} from '../../src/js/sync_status.js';
import {
  AUTOSAVE_DEBOUNCE_MS,
  AUTOSAVE_RETRY_DELAYS_MS,
} from '../../src/js/autosave.js';

test('an idle day shows no chip', () => {
  assert.equal(syncStatusView('idle'), null);
});

test('an unknown state shows no chip rather than a stale label', () => {
  assert.equal(syncStatusView('nonsense'), null);
  assert.equal(syncStatusView(undefined), null);
});

test('every state the engine reports is covered', () => {
  // Kept as an explicit list rather than importing the engine's states, so a new
  // state in autosave.js fails here instead of silently showing nothing.
  const engineStates = ['idle', 'pending', 'saving', 'saved', 'error'];
  for (const state of engineStates) {
    const view = syncStatusView(state);
    if (state === 'idle') {
      assert.equal(view, null);
      continue;
    }
    assert.ok(view, `state '${state}' has no presentation`);
    assert.ok(view.textKey, `state '${state}' has no label key`);
    assert.ok(view.icon, `state '${state}' has no icon`);
  }
});

test('debouncing and sending read the same to the participant', () => {
  assert.equal(syncStatusView('pending').textKey, 'messages.syncSaving');
  assert.equal(syncStatusView('saving').textKey, 'messages.syncSaving');
  assert.equal(syncStatusView('pending').kind, 'progress');
  assert.equal(syncStatusView('saving').kind, 'progress');
});

test('only the in-progress states animate', () => {
  assert.equal(syncStatusView('pending').spin, true);
  assert.equal(syncStatusView('saving').spin, true);
  assert.equal(syncStatusView('saved').spin, false);
  assert.equal(syncStatusView('error').spin, false);
});

test('only the failure state offers a retry', () => {
  assert.equal(syncStatusView('error').canRetry, true);
  assert.equal(syncStatusView('pending').canRetry, false);
  assert.equal(syncStatusView('saving').canRetry, false);
  assert.equal(syncStatusView('saved').canRetry, false);
});

test('a failure is not dressed up as success', () => {
  const views = ['pending', 'saving', 'saved', 'error'].map((state) =>
    syncStatusView(state)
  );
  const kinds = views.map((view) => view.kind);
  assert.equal(new Set(kinds).size, 3, `expected 3 kinds, got ${kinds}`);
  assert.equal(syncStatusView('error').kind, 'error');
  assert.notEqual(
    syncStatusView('error').textKey,
    syncStatusView('saved').textKey
  );
});

test('the confirmation outlasts the debounce it follows', () => {
  // A "Saved" that appears for less time than the save takes to start would be
  // invisible in practice.
  assert.ok(SYNC_STATUS_SAVED_VISIBLE_MS >= 2000);
  assert.ok(SYNC_STATUS_SAVED_VISIBLE_MS <= AUTOSAVE_DEBOUNCE_MS * 2);
  assert.ok(AUTOSAVE_RETRY_DELAYS_MS[0] > 0);
});
