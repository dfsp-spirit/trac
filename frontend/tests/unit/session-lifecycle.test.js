import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  buildTimeoutUrl,
  createSessionLifecycle,
  customTimeoutText,
} from '../../src/js/ui/sessionLifecycle.js';

function fakeClock() {
  let now = 0;
  let nextId = 1;
  let timers = [];
  return {
    now: () => now,
    setTimeout: (fn, ms) => {
      const id = nextId++;
      timers.push({ id, at: now + ms, fn });
      return id;
    },
    clearTimeout: (id) => {
      timers = timers.filter((timer) => timer.id !== id);
    },
    advance: (ms) => {
      const target = now + ms;
      for (;;) {
        const due = timers
          .filter((timer) => timer.at <= target)
          .sort((a, b) => a.at - b.at || a.id - b.id)[0];
        if (!due) break;
        now = due.at;
        timers = timers.filter((timer) => timer.id !== due.id);
        due.fn();
      }
      now = target;
    },
    jump: (ms) => {
      now += ms;
    },
  };
}

function fakeDocument() {
  const listeners = new Map();
  return {
    baseURI: 'http://example.test/report/',
    visibilityState: 'visible',
    addEventListener: (type, fn) => {
      const set = listeners.get(type) ?? new Set();
      set.add(fn);
      listeners.set(type, set);
    },
    removeEventListener: (type, fn) => {
      listeners.get(type)?.delete(fn);
    },
    fire: (type) => {
      for (const fn of listeners.get(type) ?? []) fn();
    },
  };
}

function fakeApi() {
  const calls = { start: 0, touch: 0, end: 0 };
  return {
    calls,
    startSession: async () => {
      calls.start += 1;
      return { active: true };
    },
    touchSession: async () => {
      calls.touch += 1;
      return { active: true };
    },
    endSession: async () => {
      calls.end += 1;
    },
  };
}

const session = (overrides = {}) => ({
  stage: 'diary',
  inactivity_timeout_minutes: 30,
  default_language: 'en',
  inactivity_page_custom_text: null,
  ...overrides,
});

test('buildTimeoutUrl carries only the language and optional study text', () => {
  const url = new URL(
    buildTimeoutUrl({
      baseUrl: 'http://example.test/report/?study=s&pid=p',
      language: 'de',
      text: 'Bitte Einladungslink öffnen.',
    })
  );
  assert.equal(url.pathname, '/report/timeout.html');
  assert.equal(url.searchParams.get('lang'), 'de');
  assert.equal(url.searchParams.get('text'), 'Bitte Einladungslink öffnen.');
  assert.equal(url.searchParams.has('study'), false);
  assert.equal(url.searchParams.has('pid'), false);
});

test('customTimeoutText falls back to the study default language', () => {
  const value = customTimeoutText(
    session({
      default_language: 'de',
      inactivity_page_custom_text: { de: 'Deutsch', en: 'English' },
    }),
    'sv'
  );
  assert.equal(value, 'Deutsch');
});

test('a timeout of zero never starts a session or a timer', () => {
  const clock = fakeClock();
  const api = fakeApi();
  let expired = 0;
  const lifecycle = createSessionLifecycle({
    api,
    getLanguage: () => 'en',
    getSession: () => session({ inactivity_timeout_minutes: 0 }),
    onExpire: () => (expired += 1),
    documentRef: fakeDocument(),
    now: clock.now,
    setTimeoutFn: clock.setTimeout,
    clearTimeoutFn: clock.clearTimeout,
  });

  lifecycle.sync(session({ inactivity_timeout_minutes: 0 }));
  clock.advance(24 * 60 * 60 * 1000);
  assert.equal(api.calls.start, 0);
  assert.equal(expired, 0);
});

test('activity resets the deadline and touches the server', () => {
  const clock = fakeClock();
  const api = fakeApi();
  let expired = 0;
  const doc = fakeDocument();
  const lifecycle = createSessionLifecycle({
    api,
    getLanguage: () => 'en',
    getSession: () => session(),
    onExpire: () => (expired += 1),
    documentRef: doc,
    now: clock.now,
    setTimeoutFn: clock.setTimeout,
    clearTimeoutFn: clock.clearTimeout,
  });

  lifecycle.sync(session());
  assert.equal(api.calls.start, 1);

  clock.advance(29 * 60 * 1000);
  doc.fire('keydown');
  clock.advance(2 * 60 * 1000);
  assert.equal(expired, 0);
  assert.equal(api.calls.touch, 1);

  clock.advance(30 * 60 * 1000);
  assert.equal(expired, 1);
  assert.equal(api.calls.end, 1);
});

test('becoming visible after the deadline expires immediately', () => {
  const clock = fakeClock();
  const api = fakeApi();
  const doc = fakeDocument();
  /** @type {string[]} */
  const urls = [];
  const lifecycle = createSessionLifecycle({
    api,
    getLanguage: () => 'de',
    getSession: () => session(),
    onExpire: (url) => urls.push(url),
    documentRef: doc,
    now: clock.now,
    setTimeoutFn: clock.setTimeout,
    clearTimeoutFn: clock.clearTimeout,
  });

  lifecycle.sync(session());
  clock.jump(31 * 60 * 1000);
  doc.fire('visibilitychange');
  assert.equal(urls.length, 1);
  assert.match(urls[0], /timeout\.html\?lang=de/);
});

test('a terminal stage stops the timer', () => {
  const clock = fakeClock();
  const api = fakeApi();
  let expired = 0;
  const lifecycle = createSessionLifecycle({
    api,
    getLanguage: () => 'en',
    getSession: () => session({ stage: 'done' }),
    onExpire: () => (expired += 1),
    documentRef: fakeDocument(),
    now: clock.now,
    setTimeoutFn: clock.setTimeout,
    clearTimeoutFn: clock.clearTimeout,
  });

  lifecycle.sync(session({ stage: 'done' }));
  clock.advance(24 * 60 * 60 * 1000);
  assert.equal(api.calls.start, 0);
  assert.equal(expired, 0);
});
