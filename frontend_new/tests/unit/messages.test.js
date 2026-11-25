import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createMessagesClient } from '../../src/js/data/messages.js';

// The banner payload is small, so the rules worth pinning are the boring ones:
// the query string the server expects, the shape the UI may rely on, and "a
// missing banner is never an error".

/**
 * @param {any} payload
 * @param {{ ok?: boolean, throws?: boolean, onUrl?: (url: string) => void }} [options]
 * @returns {typeof fetch}
 */
function fakeFetch(payload, { ok = true, throws = false, onUrl } = {}) {
  return /** @type {any} */ (
    async (url) => {
      onUrl?.(String(url));
      if (throws) throw new Error('offline');
      return { ok, json: async () => payload };
    }
  );
}

test('the request carries the study and the language only when they exist', async () => {
  const urls = [];
  const client = createMessagesClient('/api', {
    fetchImpl: fakeFetch({}, { onUrl: (url) => urls.push(url) }),
  });

  await client.getMessages();
  await client.getMessages({ studyName: 'pilot', language: 'de' });

  assert.deepEqual(urls, ['/api/messages', '/api/messages?study_name_short=pilot&lang=de']);
});

test('both messages are normalized', async () => {
  const client = createMessagesClient('/api', {
    fetchImpl: fakeFetch({
      server: { text: 'Maintenance tonight', key: 'srv-1' },
      study: { text: 'No diary tomorrow', key: 'study-1' },
    }),
  });

  assert.deepEqual(await client.getMessages(), {
    server: { text: 'Maintenance tonight', key: 'srv-1' },
    study: { text: 'No diary tomorrow', key: 'study-1' },
  });
});

test('malformed entries are dropped instead of rendered', async () => {
  const client = createMessagesClient('/api', {
    fetchImpl: fakeFetch({
      server: { text: '   ', key: 'srv-1' },
      study: { text: 'No key' },
    }),
  });

  assert.deepEqual(await client.getMessages(), { server: null, study: null });
});

test('a failed request shows no banner and does not throw', async () => {
  const failing = createMessagesClient('/api', {
    fetchImpl: fakeFetch({}, { ok: false }),
  });
  const offline = createMessagesClient('/api', {
    fetchImpl: fakeFetch({}, { throws: true }),
  });

  assert.deepEqual(await failing.getMessages(), { server: null, study: null });
  assert.deepEqual(await offline.getMessages(), { server: null, study: null });
});
