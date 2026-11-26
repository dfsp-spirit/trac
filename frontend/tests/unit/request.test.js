import { test } from 'node:test';
import assert from 'node:assert/strict';

import { ApiError, createRequest } from '../../src/js/data/request.js';

function withFetch(response, fn) {
  return async () => {
    const original = globalThis.fetch;
    globalThis.fetch = async () => response;
    try {
      await fn();
    } finally {
      globalThis.fetch = original;
    }
  };
}

test('a session 401 calls the expiry hook and still throws a coded error', async () => {
  await withFetch(
    new Response(
      JSON.stringify({
        detail: { code: 'session.expired', message: 'Session ended' },
      }),
      { status: 401, headers: { 'Content-Type': 'application/json' } }
    ),
    async () => {
      const seen = [];
      const request = createRequest('/api', 'p1', {
        onSessionExpired: (info) => seen.push(info.code),
        onError: () => assert.fail('a coded 4xx is not a generic API error'),
      });
      await assert.rejects(
        request('/api/studies/s/participants/p1/diary'),
        (error) => error instanceof ApiError && error.code === 'session.expired'
      );
      assert.deepEqual(seen, ['session.expired']);
    }
  )();
});

test('an unrelated 401 does not redirect the participant', async () => {
  await withFetch(
    new Response(JSON.stringify({ detail: { code: 'not_authorized' } }), {
      status: 401,
      headers: { 'Content-Type': 'application/json' },
    }),
    async () => {
      let expired = false;
      const request = createRequest('/api', 'p1', {
        onSessionExpired: () => (expired = true),
      });
      await assert.rejects(
        request('/api/studies/s/participants/p1/diary'),
        (error) => error instanceof ApiError && error.code === 'not_authorized'
      );
      assert.equal(expired, false);
    }
  )();
});

test('session requests send cookies', async () => {
  await withFetch(
    new Response(JSON.stringify({ active: true }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    }),
    async () => {
      const original = globalThis.fetch;
      let options;
      globalThis.fetch = async (_url, next) => {
        options = next;
        return new Response(JSON.stringify({ active: true }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      };
      try {
        const request = createRequest('/api', 'p1');
        await request('/api/studies/s/participants/p1/session', { method: 'POST' });
      } finally {
        globalThis.fetch = original;
      }
      assert.equal(options.credentials, 'include');
    }
  )();
});
