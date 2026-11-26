import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  buildClientInfo,
  shouldCaptureClientInfo,
} from '../../src/js/domain/clientInfo.js';

// Browser/device identification (study flag `save_browser_identification`).
// Two rules decide everything: nothing is collected without consent, and the
// browser sends raw values only - no parsed user agent, because a stored parse
// result goes stale while the raw string stays re-derivable.

const SESSION = {
  stage: 'diary',
  save_browser_identification: true,
  require_consent: false,
  consent_given: null,
};

test('nothing is reported for a study that does not collect it', () => {
  assert.equal(shouldCaptureClientInfo({ ...SESSION, save_browser_identification: false }), false);
  assert.equal(shouldCaptureClientInfo({ ...SESSION, save_browser_identification: undefined }), false);
  assert.equal(shouldCaptureClientInfo(null), false);
});

test('a consent-requiring study waits for consent', () => {
  const consenting = { ...SESSION, require_consent: true };
  assert.equal(shouldCaptureClientInfo(consenting), false);
  assert.equal(shouldCaptureClientInfo({ ...consenting, consent_given: false }), false);
  assert.equal(shouldCaptureClientInfo({ ...consenting, consent_given: true }), true);
});

test('a study without a consent step reports right away', () => {
  assert.equal(shouldCaptureClientInfo(SESSION), true);
});

test('there is no session to report on before the study is known', () => {
  assert.equal(shouldCaptureClientInfo({ save_browser_identification: true }), false);
});

test('the payload carries raw signals and the user agent, never a parse result', () => {
  const body = buildClientInfo({
    userAgent: 'Mozilla/5.0 (iPhone)',
    platform: 'iPhone',
    language: 'de',
    timeZone: 'Europe/Berlin',
    screen: { width: 390, height: 844 },
    viewport: { width: 390, height: 664 },
    devicePixelRatio: 3,
    maxTouchPoints: 5,
  });

  assert.deepEqual(body, {
    user_agent: 'Mozilla/5.0 (iPhone)',
    client_info: {
      platform: 'iPhone',
      language: 'de',
      timezone: 'Europe/Berlin',
      screen: { width: 390, height: 844 },
      viewport: { width: 390, height: 664 },
      device_pixel_ratio: 3,
      max_touch_points: 5,
    },
  });

  // A parsed snapshot is exactly what the backend whitelist drops; do not send it.
  for (const key of ['browser', 'engine', 'os', 'device', 'cpu', 'parser_library']) {
    assert.equal(key in body.client_info, false);
  }
});

test('missing values are omitted instead of sent as null', () => {
  const body = buildClientInfo({ viewport: { width: 390, height: 664 } });

  assert.equal('user_agent' in body, false);
  assert.deepEqual(body.client_info, { viewport: { width: 390, height: 664 } });
});

test('a partially known screen keeps the known half', () => {
  const body = buildClientInfo({ screen: { width: 390 }, viewport: { width: 1, height: 2 } });

  assert.deepEqual(body.client_info.screen, { width: 390 });
});

test('an incomplete viewport is dropped rather than stored half-empty', () => {
  const body = buildClientInfo({ viewport: { width: 390 } });

  assert.equal('viewport' in body.client_info, false);
});
