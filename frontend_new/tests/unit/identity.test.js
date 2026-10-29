import { test } from 'node:test';
import assert from 'node:assert/strict';
import { generateParticipantId } from '../../src/js/domain/participantId.js';
import { adoptParticipantId } from '../../src/js/ui/identity.js';

test('a generated participant id is sixteen digits', () => {
  for (let i = 0; i < 25; i += 1) {
    assert.match(generateParticipantId(), /^\d{16}$/);
  }
});

test('an invitation link keeps the participant id it carries', () => {
  assert.equal(adoptParticipantId({ studyName: 'adult', participantId: 'bernd' }), 'bernd');
});

test('without a study there is nobody to join as', () => {
  assert.equal(adoptParticipantId({ studyName: null, participantId: null }), null);
});

test('an open study link gets a pid written back to the URL', () => {
  const replaced = [];
  globalThis.window = {
    location: { href: 'http://localhost:3000/report-new/index.html?study=adult&lang=de' },
    history: { replaceState: (...args) => replaced.push(args) },
  };

  try {
    const pid = adoptParticipantId({ studyName: 'adult', participantId: null });

    assert.match(pid, /^\d{16}$/);
    assert.equal(replaced.length, 1);
    const url = replaced[0][2];
    assert.equal(url.searchParams.get('study'), 'adult');
    assert.equal(url.searchParams.get('lang'), 'de');
    assert.equal(url.searchParams.get('pid'), pid);
  } finally {
    delete globalThis.window;
  }
});
