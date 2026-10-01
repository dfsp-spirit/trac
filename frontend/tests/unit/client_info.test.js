// Unit tests for the browser/device identification capture (client_info.js).
//
// The module is deliberately best-effort: it must never throw, must respect the
// per-study flag, must not re-post for the same participant, and must still
// record the raw user agent when the vendored parser is unavailable.
import './setup.js';
import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  PARSER_VERSION,
  captureClientInfoIfEnabled,
} from '../../src/js/client_info.js';

const API_BASE_URL = 'http://localhost:8000/api';
const STUDY = 'demo_study';
const PID = 'p1';

function memoryStorage() {
  const data = new Map();
  return {
    getItem: (key) => (data.has(key) ? data.get(key) : null),
    setItem: (key, value) => data.set(key, String(value)),
    removeItem: (key) => data.delete(key),
    _data: data,
  };
}

/** Install fresh browser globals for one test. */
function installGlobals({ localStorage = memoryStorage(), userAgentData } = {}) {
  globalThis.TUD_SETTINGS = { API_BASE_URL };
  // In the browser TUD_SETTINGS is a property of window; client_info.js reads it
  // through window, so the stub has to live there too.
  globalThis.window.TUD_SETTINGS = globalThis.TUD_SETTINGS;
  globalThis.window.localStorage = localStorage;
  globalThis.window.innerWidth = 390;
  globalThis.window.innerHeight = 664;
  globalThis.window.devicePixelRatio = 3;
  globalThis.window.screen = { width: 390, height: 844, colorDepth: 24 };
  globalThis.window.UAParser = undefined;

  // Node exposes its own read-only `navigator`, so it has to be replaced rather
  // than mutated.
  const fakeNavigator = {
    userAgent:
      'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15',
    platform: 'iPhone',
    maxTouchPoints: 5,
    hardwareConcurrency: 6,
    language: 'de',
    languages: ['de', 'en'],
  };
  if (userAgentData) {
    fakeNavigator.userAgentData = userAgentData;
  }
  Object.defineProperty(globalThis, 'navigator', {
    value: fakeNavigator,
    configurable: true,
    writable: true,
  });

  return localStorage;
}

/** Minimal stand-in for the vendored ua-parser-js bundle. */
function stubUAParser() {
  globalThis.window.UAParser = function UAParser() {
    this.getResult = () => ({
      browser: { name: 'Mobile Safari', version: '17.5' },
      engine: { name: 'WebKit', version: '605.1.15' },
      os: { name: 'iOS', version: '17.5' },
      device: { vendor: 'Apple', model: 'iPhone', type: 'mobile' },
      cpu: { architecture: 'arm64' },
    });
  };
}

test('a disabled study is skipped without any request', async () => {
  installGlobals();
  let fetchCalls = 0;
  globalThis.fetch = async () => {
    fetchCalls += 1;
    return { ok: true, status: 200 };
  };

  const result = await captureClientInfoIfEnabled({
    studyNameShort: STUDY,
    participantId: PID,
    enabled: false,
  });

  assert.equal(result.sent, false);
  assert.equal(result.reason, 'disabled_for_study');
  assert.equal(fetchCalls, 0);
});

test('capture is skipped when the participant or study is unknown', async () => {
  installGlobals();
  globalThis.fetch = async () => {
    throw new Error('fetch must not be called');
  };

  const noParticipant = await captureClientInfoIfEnabled({
    studyNameShort: STUDY,
    participantId: null,
    enabled: true,
  });
  const noStudy = await captureClientInfoIfEnabled({
    studyNameShort: null,
    participantId: PID,
    enabled: true,
  });

  assert.equal(noParticipant.reason, 'missing_study_or_participant');
  assert.equal(noStudy.reason, 'missing_study_or_participant');
});

test('the parsed snapshot is posted and then not repeated', async () => {
  const localStorage = installGlobals();
  stubUAParser();

  const requests = [];
  globalThis.fetch = async (url, options) => {
    requests.push({ url, options });
    return { ok: true, status: 200 };
  };

  const first = await captureClientInfoIfEnabled({
    studyNameShort: STUDY,
    participantId: PID,
    enabled: true,
  });

  assert.equal(first.sent, true);
  assert.equal(requests.length, 1);
  assert.equal(
    requests[0].url,
    `${API_BASE_URL}/studies/${STUDY}/participants/${PID}/client-info`
  );
  assert.equal(requests[0].options.method, 'POST');

  const body = JSON.parse(requests[0].options.body);
  assert.equal(body.user_agent, globalThis.navigator.userAgent);
  assert.equal(body.client_info.browser.name, 'Mobile Safari');
  assert.equal(body.client_info.os.name, 'iOS');
  assert.equal(body.client_info.device.type, 'mobile');
  assert.equal(body.client_info.screen.width, 390);
  assert.equal(body.client_info.viewport.height, 664);
  assert.equal(body.client_info.device_pixel_ratio, 3);
  assert.equal(body.client_info.max_touch_points, 5);
  assert.equal(body.client_info.parser_version, PARSER_VERSION);

  // Second call for the same participant is a no-op.
  const second = await captureClientInfoIfEnabled({
    studyNameShort: STUDY,
    participantId: PID,
    enabled: true,
  });

  assert.equal(second.sent, false);
  assert.equal(second.reason, 'already_sent');
  assert.equal(requests.length, 1);
  assert.equal(localStorage._data.size, 1);
});

test('the raw user agent is still recorded when the parser did not load', async () => {
  installGlobals(); // no UAParser global

  let postedBody = null;
  globalThis.fetch = async (url, options) => {
    postedBody = JSON.parse(options.body);
    return { ok: true, status: 200 };
  };

  const result = await captureClientInfoIfEnabled({
    studyNameShort: STUDY,
    participantId: PID,
    enabled: true,
  });

  assert.equal(result.sent, true);
  assert.equal(postedBody.user_agent, globalThis.navigator.userAgent);
  assert.equal(postedBody.client_info.parser_library, null);
  assert.equal(postedBody.client_info.browser, undefined);
});

test('a failed submission is not marked as sent, so it retries later', async () => {
  const localStorage = installGlobals();

  globalThis.fetch = async () => ({ ok: false, status: 500 });

  const result = await captureClientInfoIfEnabled({
    studyNameShort: STUDY,
    participantId: PID,
    enabled: true,
  });

  assert.equal(result.sent, false);
  assert.equal(result.reason, 'http_500');
  assert.equal(localStorage._data.size, 0);
});

test('a throwing fetch never propagates', async () => {
  installGlobals();
  globalThis.fetch = async () => {
    throw new Error('network down');
  };

  const result = await captureClientInfoIfEnabled({
    studyNameShort: STUDY,
    participantId: PID,
    enabled: true,
  });

  assert.equal(result.sent, false);
  assert.equal(result.reason, 'request_failed');
});

test('Client Hints are included when the browser exposes them', async () => {
  installGlobals({
    userAgentData: {
      mobile: true,
      platform: 'iOS',
      brands: [{ brand: 'Safari', version: '17' }],
      getHighEntropyValues: async () => ({ architecture: 'arm', bitness: '64' }),
    },
  });

  let postedBody = null;
  globalThis.fetch = async (url, options) => {
    postedBody = JSON.parse(options.body);
    return { ok: true, status: 200 };
  };

  await captureClientInfoIfEnabled({
    studyNameShort: STUDY,
    participantId: PID,
    enabled: true,
  });

  assert.equal(postedBody.client_info.client_hints.mobile, true);
  assert.equal(postedBody.client_info.client_hints.platform, 'iOS');
  assert.deepEqual(postedBody.client_info.client_hints.high_entropy, {
    architecture: 'arm',
    bitness: '64',
  });
});

test('without API settings the capture is skipped instead of throwing', async () => {
  installGlobals();
  globalThis.TUD_SETTINGS = {};
  globalThis.window.TUD_SETTINGS = {};

  const result = await captureClientInfoIfEnabled({
    studyNameShort: STUDY,
    participantId: PID,
    enabled: true,
  });

  assert.equal(result.sent, false);
  assert.equal(result.reason, 'no_api_base_url');
});

test('a consent-requiring study does not capture before consent is given', async () => {
  installGlobals();
  let fetchCalls = 0;
  globalThis.fetch = async () => {
    fetchCalls += 1;
    return { ok: true, status: 200 };
  };

  const beforeConsent = await captureClientInfoIfEnabled({
    studyNameShort: STUDY,
    participantId: PID,
    enabled: true,
    requiresConsent: true,
    consentGiven: false,
  });

  assert.equal(beforeConsent.sent, false);
  assert.equal(beforeConsent.reason, 'consent_not_given');
  assert.equal(fetchCalls, 0);

  const afterConsent = await captureClientInfoIfEnabled({
    studyNameShort: STUDY,
    participantId: PID,
    enabled: true,
    requiresConsent: true,
    consentGiven: true,
  });

  assert.equal(afterConsent.sent, true);
  assert.equal(fetchCalls, 1);
});

test('a study without consent requirement captures immediately', async () => {
  installGlobals();
  let fetchCalls = 0;
  globalThis.fetch = async () => {
    fetchCalls += 1;
    return { ok: true, status: 200 };
  };

  const result = await captureClientInfoIfEnabled({
    studyNameShort: STUDY,
    participantId: PID,
    enabled: true,
    requiresConsent: false,
    consentGiven: false,
  });

  assert.equal(result.sent, true);
  assert.equal(fetchCalls, 1);
});

test('sendBeacon is preferred and survives the post-config redirect', async () => {
  const localStorage = installGlobals();
  const beaconCalls = [];
  globalThis.navigator.sendBeacon = (url, body) => {
    beaconCalls.push({ url, body });
    return true;
  };
  let fetchCalls = 0;
  globalThis.fetch = async () => {
    fetchCalls += 1;
    return { ok: true, status: 200 };
  };

  const result = await captureClientInfoIfEnabled({
    studyNameShort: STUDY,
    participantId: PID,
    enabled: true,
  });

  assert.equal(result.sent, true);
  assert.equal(result.transport, 'beacon');
  assert.equal(beaconCalls.length, 1);
  assert.equal(
    beaconCalls[0].url,
    `${API_BASE_URL}/studies/${STUDY}/participants/${PID}/client-info`
  );
  assert.ok(beaconCalls[0].body instanceof Blob);
  // A beacon cannot report a status, so the marker is set optimistically.
  assert.equal(localStorage._data.size, 1);
  assert.equal(fetchCalls, 0);
});

test('a rejected beacon falls back to fetch so the data is not lost', async () => {
  installGlobals();
  globalThis.navigator.sendBeacon = () => false;

  const requests = [];
  globalThis.fetch = async (url, options) => {
    requests.push({ url, options });
    return { ok: true, status: 200 };
  };

  const result = await captureClientInfoIfEnabled({
    studyNameShort: STUDY,
    participantId: PID,
    enabled: true,
  });

  assert.equal(result.sent, true);
  assert.equal(result.transport, undefined);
  assert.equal(requests.length, 1);
});

test('a throwing sendBeacon falls back to fetch', async () => {
  installGlobals();
  globalThis.navigator.sendBeacon = () => {
    throw new Error('beacon unavailable');
  };

  let fetchCalls = 0;
  globalThis.fetch = async () => {
    fetchCalls += 1;
    return { ok: true, status: 200 };
  };

  const result = await captureClientInfoIfEnabled({
    studyNameShort: STUDY,
    participantId: PID,
    enabled: true,
  });

  assert.equal(result.sent, true);
  assert.equal(fetchCalls, 1);
});
