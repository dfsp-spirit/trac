import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createDismissedMessages } from '../../src/js/ui/dismissedMessages.js';

// The one place the app touches device storage. The rules that matter: a
// dismissal survives a reload, the list cannot grow forever, and broken or
// unavailable storage never throws into the page.

/**
 * @param {Record<string, string>} [initial]
 */
function fakeStorage(initial = {}) {
  const entries = new Map(Object.entries(initial));
  return {
    entries,
    getItem: (key) => (entries.has(key) ? /** @type {string} */ (entries.get(key)) : null),
    setItem: (key, value) => {
      entries.set(key, value);
    },
  };
}

test('a remembered key is reported as dismissed', () => {
  const storage = fakeStorage();
  const dismissed = createDismissedMessages(storage);

  assert.equal(dismissed.has('srv-1'), false);
  dismissed.remember('srv-1');
  assert.equal(dismissed.has('srv-1'), true);
});

test('remembering twice keeps one entry', () => {
  const storage = fakeStorage();
  const dismissed = createDismissedMessages(storage);

  dismissed.remember('srv-1');
  dismissed.remember('srv-1');

  assert.deepEqual(JSON.parse(/** @type {string} */ (storage.entries.values().next().value)), ['srv-1']);
});

test('the ledger stays bounded', () => {
  const storage = fakeStorage();
  const dismissed = createDismissedMessages(storage);

  for (let index = 0; index < 30; index += 1) dismissed.remember(`msg-${index}`);

  assert.equal(dismissed.has('msg-29'), true);
  assert.equal(dismissed.has('msg-0'), false);
});

test('broken storage means "nothing dismissed", never an exception', () => {
  const broken = {
    getItem: () => '{not json',
    setItem: () => {
      throw new Error('quota');
    },
  };
  const dismissed = createDismissedMessages(broken);

  assert.equal(dismissed.has('srv-1'), false);
  assert.doesNotThrow(() => dismissed.remember('srv-1'));
  assert.equal(dismissed.has('srv-1'), false);
});

test('no storage at all is tolerated', () => {
  const dismissed = createDismissedMessages(null);

  assert.equal(dismissed.has('srv-1'), false);
  assert.doesNotThrow(() => dismissed.remember('srv-1'));
});
