import { test } from 'node:test';
import assert from 'node:assert/strict';
import { anchorAfterSave, suggestSlot } from '../../src/js/domain/suggestSlot.js';
import { createEntrySlot } from '../../src/js/ui/entrySlot.js';

/** @param {number} start @param {number} end @param {number} [dayIndex] */
const record = (start, end, dayIndex = 0) => ({
  id: `r-${dayIndex}-${start}`,
  dayIndex,
  startMinutes: start,
  endMinutes: end,
});

// ── The suggestion itself ──────────────────────────────────────────────────
// One rule: start where the participant is looking, in the next free minute,
// and stop after an hour or at the next entry, whichever comes first.

test('an empty day gives the anchor and an hour', () => {
  assert.deepEqual(suggestSlot({ anchorMinutes: 600 }), {
    startMinutes: 600,
    endMinutes: 660,
  });
});

test('the anchor snaps up to the step, never down', () => {
  // 10:03 means the participant is looking at 10:10, not at a minute they
  // cannot see; the selects only offer steps.
  assert.deepEqual(suggestSlot({ anchorMinutes: 603 }), {
    startMinutes: 610,
    endMinutes: 670,
  });
});

test('an anchor inside an existing entry moves to the next free minute', () => {
  const slot = suggestSlot({
    anchorMinutes: 600,
    records: [record(570, 660)],
  });

  assert.deepEqual(slot, { startMinutes: 660, endMinutes: 720 });
});

test('the hour is shortened by the next entry instead of overlapping it', () => {
  const slot = suggestSlot({
    anchorMinutes: 600,
    records: [record(620, 700)],
  });

  assert.deepEqual(slot, { startMinutes: 600, endMinutes: 620 });
});

test('a free block too short for an entry is skipped', () => {
  // Five minutes between 10:05 and 10:10 is not an entry, so the suggestion
  // starts after the block that follows it.
  const slot = suggestSlot({
    anchorMinutes: 600,
    records: [record(605, 700)],
  });

  assert.deepEqual(slot, { startMinutes: 700, endMinutes: 760 });
});

test('a late anchor still gets its last step, capped at midnight', () => {
  assert.deepEqual(suggestSlot({ anchorMinutes: 1435 }), {
    startMinutes: 1430,
    endMinutes: 1440,
  });
  assert.deepEqual(suggestSlot({ anchorMinutes: 1380 }), {
    startMinutes: 1380,
    endMinutes: 1440,
  });
});

test('a full day falls back to a short slot at the anchor', () => {
  // Nothing free to offer, so the form keeps the participant where they are and
  // its neighbour hint explains what saving would overlap.
  const slot = suggestSlot({
    anchorMinutes: 600,
    records: [record(0, 1440)],
  });

  assert.deepEqual(slot, { startMinutes: 600, endMinutes: 610 });
});

test('only the entries of the requested day block it', () => {
  const slot = suggestSlot({
    anchorMinutes: 600,
    dayIndex: 2,
    records: [record(0, 1440, 1), record(0, 1440, 3)],
  });

  assert.deepEqual(slot, { startMinutes: 600, endMinutes: 660 });
});

test('a cross-midnight entry blocks the morning after it', () => {
  // 22:00 on day 0 until 06:00 on day 1, so day 1 starts busy until 06:00.
  const slot = suggestSlot({
    anchorMinutes: 60,
    dayIndex: 1,
    records: [record(1320, 1800, 0)],
  });

  assert.deepEqual(slot, { startMinutes: 360, endMinutes: 420 });
});

test('broken records are ignored instead of blocking the day', () => {
  const slot = suggestSlot({
    anchorMinutes: 600,
    records: [record(600, 600), record(Number.NaN, 700)],
  });

  assert.deepEqual(slot, { startMinutes: 600, endMinutes: 660 });
});

test('a negative anchor starts at the beginning of the day', () => {
  assert.deepEqual(suggestSlot({ anchorMinutes: -120 }), {
    startMinutes: 0,
    endMinutes: 60,
  });
});

test('the duration is configurable and still clamped', () => {
  assert.deepEqual(suggestSlot({ anchorMinutes: 600, durationMinutes: 30 }), {
    startMinutes: 600,
    endMinutes: 630,
  });
  assert.deepEqual(
    suggestSlot({ anchorMinutes: 600, durationMinutes: 120, records: [record(690, 800)] }),
    { startMinutes: 600, endMinutes: 690 }
  );
});

test('save-and-add-another continues where the entry ended', () => {
  assert.deepEqual(
    anchorAfterSave({ dayIndex: 2, startMinutes: 600, endMinutes: 660 }),
    { dayIndex: 2, anchorMinutes: 660 }
  );
});

test('save-and-add-another continues on the next day after midnight', () => {
  assert.deepEqual(
    anchorAfterSave({ dayIndex: 0, startMinutes: 1380, endMinutes: 1500 }),
    { dayIndex: 1, anchorMinutes: 60 }
  );
});

// ── The three ways into the form ───────────────────────────────────────────

/** @param {Partial<{ day: number, anchor: number }>} [options] */
function entrySlot({ day = 3, anchor = 600 } = {}) {
  return createEntrySlot({
    getCurrentDay: () => day,
    getAnchorMinutes: () => anchor,
  });
}

test('without a click the slot follows the day in view', () => {
  assert.deepEqual(entrySlot({ day: 4, anchor: 900 }).resolve([]), {
    dayIndex: 4,
    startMinutes: 900,
    endMinutes: 960,
  });
});

test('a clicked gap is used exactly, and only once', () => {
  const slot = entrySlot({ day: 1, anchor: 600 });
  slot.claim({ dayIndex: 5, startMinutes: 840, endMinutes: 930 });

  assert.deepEqual(slot.resolve([]), {
    dayIndex: 5,
    startMinutes: 840,
    endMinutes: 930,
  });

  // The next entry follows the view again: a stale click used to pre-fill it.
  assert.deepEqual(slot.resolve([]), {
    dayIndex: 1,
    startMinutes: 600,
    endMinutes: 660,
  });
});

test('an anchor from the add button is still clamped to free time', () => {
  const slot = entrySlot();
  slot.anchor({ dayIndex: 0, anchorMinutes: 600 });

  assert.deepEqual(slot.resolve([record(620, 700)]), {
    dayIndex: 0,
    startMinutes: 600,
    endMinutes: 620,
  });
});

test('save-and-add-another is an anchor, so it is clamped too', () => {
  const slot = entrySlot();
  slot.continueAfter({ dayIndex: 0, startMinutes: 540, endMinutes: 600 });

  // The next entry sits ten minutes later: the continuation stops there.
  assert.deepEqual(slot.resolve([record(610, 700)]), {
    dayIndex: 0,
    startMinutes: 600,
    endMinutes: 610,
  });
});

test('the slot reports the day the next entry would land on', () => {
  const slot = entrySlot({ day: 2 });
  assert.equal(slot.dayIndex, 2);
  slot.claim({ dayIndex: 6, startMinutes: 0, endMinutes: 60 });
  assert.equal(slot.dayIndex, 6);
});
