import { test } from 'node:test';
import assert from 'node:assert/strict';
import { nudgeRange } from '../../src/js/domain/nudge.js';

/** 08:00-09:00, the ordinary case. */
const hour = { startMinutes: 480, endMinutes: 540 };

test('a move shifts both edges by one step', () => {
  assert.deepEqual(nudgeRange(hour, { mode: 'move', delta: 10 }), {
    startMinutes: 490,
    endMinutes: 550,
  });
  assert.deepEqual(nudgeRange(hour, { mode: 'move', delta: -10 }), {
    startMinutes: 470,
    endMinutes: 530,
  });
});

test('a resize moves only the end', () => {
  assert.deepEqual(nudgeRange(hour, { mode: 'resize', delta: 10 }), {
    startMinutes: 480,
    endMinutes: 550,
  });
  assert.deepEqual(nudgeRange(hour, { mode: 'resize', delta: -10 }), {
    startMinutes: 480,
    endMinutes: 530,
  });
});

test('a block cannot be moved out of its own day', () => {
  assert.equal(nudgeRange({ startMinutes: 0, endMinutes: 60 }, { mode: 'move', delta: -10 }), null);
  assert.equal(
    nudgeRange({ startMinutes: 1430, endMinutes: 1440 }, { mode: 'move', delta: 10 }),
    null,
    'the start must stay inside the day it belongs to (D6)'
  );
});

test('a block keeps at least one step', () => {
  assert.equal(nudgeRange({ startMinutes: 480, endMinutes: 490 }, { mode: 'resize', delta: -10 }), null);
  assert.deepEqual(nudgeRange({ startMinutes: 480, endMinutes: 490 }, { mode: 'resize', delta: 10 }), {
    startMinutes: 480,
    endMinutes: 500,
  });
});

test('the end may still reach past midnight, like the form allows', () => {
  // 23:30 + 60 minutes already ends on the next day; moving it later keeps that.
  assert.deepEqual(nudgeRange({ startMinutes: 1410, endMinutes: 1500 }, { mode: 'move', delta: 10 }), {
    startMinutes: 1420,
    endMinutes: 1510,
  });
});

