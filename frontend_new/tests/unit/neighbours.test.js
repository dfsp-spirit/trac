import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  SNAP_MAX_MINUTES,
  neighbourRows,
  surrounding,
} from '../../src/js/domain/neighbours.js';

// The surroundings block under the activity form. It exists because the phone
// form covers the timeline, and it must report *boundaries* (what ends where),
// never history (what was added last). Rows are asserted with their `kind`, since
// the label the participant sees is chosen from it.

/** Record as the form builds it: day-relative minutes, plus a display name. */
function record(id, dayIndex, startMinutes, endMinutes, name = id) {
  return { id, dayIndex, startMinutes, endMinutes, name };
}

/** Compose with a translator that shows the key and its values, so the test
 *  asserts *what* is said rather than English wording. */
function translator(key, values = {}) {
  const args = Object.entries(values)
    .map(([name, value]) => `${name}=${value}`)
    .join(',');
  return `${key}(${args})`;
}

const clock = (minute) => {
  const total = ((minute % 1440) + 1440) % 1440;
  return `${String(Math.floor(total / 60)).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`;
};

const short = (name) => name;

/** No weekday marker: every minute is treated as the day being edited. */
const describe = (minute) => ({ time: clock(minute), day: null });

/** A marker for minutes that leave the candidate's day (absolute day 1, 2, ...). */
const describeWithDay = (minute) => ({
  time: clock(minute),
  day: minute >= 1440 ? `day-${Math.floor(minute / 1440)}` : null,
});

function rows(found) {
  return neighbourRows(found, translator, describe, short);
}

/** Rows with the weekday marker for minutes that leave the candidate's day. */
function rowsWithDay(found) {
  return neighbourRows(found, translator, describeWithDay, short);
}

/** The rows' texts joined, for the tests that only care about the wording. */
function text(found) {
  return rows(found)
    .map((row) => row.text)
    .join(' · ');
}

function textWithDay(found) {
  return rowsWithDay(found)
    .map((row) => row.text)
    .join(' · ');
}

test('an empty day says nothing', () => {
  const found = surrounding({
    candidate: record('new', 0, 360, 420),
    existing: [],
  });
  assert.deepEqual(found.overlaps, []);
  assert.equal(found.before, null);
  assert.equal(found.after, null);
  assert.equal(found.snap, null);
  assert.deepEqual(rows(found), []);
});

test('the previous entry names the boundary the participant forgot', () => {
  const found = surrounding({
    candidate: record('new', 0, 370, 400), // guessed 06:10
    existing: [record('sleep', 0, 0, 360, 'Sleeping')], // actually until 06:00
  });
  assert.deepEqual(found.before, { name: 'Sleeping', end: 360 });
  assert.equal(found.after, null);
  assert.deepEqual(rows(found), [
    {
      kind: 'before',
      text: 'diary.form.neighbour.before(name=Sleeping,time=06:00)',
    },
  ]);
});

test('a missed boundary is offered as a one-tap correction', () => {
  const found = surrounding({
    candidate: record('new', 0, 370, 400),
    existing: [record('sleep', 0, 0, 360, 'Sleeping')],
  });
  assert.deepEqual(found.snap, { name: 'Sleeping', at: 360 });
  assert.equal(
    translator('diary.form.neighbour.snap', { name: 'Sleeping', time: clock(360) }),
    'diary.form.neighbour.snap(name=Sleeping,time=06:00)'
  );
});

test('an entry that already touches its neighbour needs no chip', () => {
  const found = surrounding({
    candidate: record('new', 0, 360, 400),
    existing: [record('sleep', 0, 0, 360, 'Sleeping')],
  });
  assert.equal(found.snap, null);
  assert.equal(found.before.end, 360);
});

test('a far-away boundary is reported but not offered as a snap', () => {
  const late = record('new', 0, 720, 780); // 12:00
  const found = surrounding({
    candidate: late,
    existing: [record('sleep', 0, 0, 360, 'Sleeping')],
  });
  assert.equal(found.before.end, 360);
  assert.equal(found.snap, null);

  const edge = surrounding({
    candidate: record('new', 0, 360 + SNAP_MAX_MINUTES, 460),
    existing: [record('sleep', 0, 0, 360)],
  });
  assert.ok(edge.snap, 'exactly at the limit is still a forgotten boundary');

  const beyond = surrounding({
    candidate: record('new', 0, 361 + SNAP_MAX_MINUTES, 460),
    existing: [record('sleep', 0, 0, 360)],
  });
  assert.equal(beyond.snap, null);
});

test('the next entry is named too', () => {
  const found = surrounding({
    candidate: record('new', 0, 420, 470),
    existing: [
      record('sleep', 0, 0, 360, 'Sleeping'),
      record('lunch', 0, 720, 780, 'Lunch'),
    ],
  });
  assert.equal(found.after.name, 'Lunch');
  assert.deepEqual(found.after, { name: 'Lunch', start: 720 });
  assert.equal(
    text(found),
    'diary.form.neighbour.before(name=Sleeping,time=06:00) · ' +
      'diary.form.neighbour.after(name=Lunch,time=12:00)'
  );
});

test('a tolerated overlap is still reported - that is the point', () => {
  // `max_overlap` allows one overlap, so nothing would refuse this save.
  const found = surrounding({
    candidate: record('new', 0, 360, 400), // 06:00-06:40
    existing: [record('sleep', 0, 0, 370, 'Sleeping')], // until 06:10
  });
  assert.equal(found.overlaps.length, 1);
  assert.equal(found.overlaps[0].minutes, 10);
  assert.equal(
    text(found),
    'diary.form.neighbour.overlap(name=Sleeping,range=06:00–06:10,minutes=10)'
  );
});

test('several overlaps are counted without listing them all', () => {
  const found = surrounding({
    candidate: record('new', 0, 600, 700),
    existing: [
      record('a', 0, 590, 620, 'Coffee'),
      record('b', 0, 680, 720, 'Snack'),
    ],
  });
  assert.equal(found.overlaps.length, 2);
  assert.equal(
    text(found),
    'diary.form.neighbour.overlap(name=Coffee,range=10:00–10:20,minutes=20) · ' +
      'diary.form.neighbour.overlapMore(count=1)'
  );
});

test('an overlap is reported beside the boundaries, in time order', () => {
  // Overlapping is legitimate data (music while cooking), not a problem to
  // report instead of the boundaries: all three facts are true and each gets
  // its own labelled row.
  const found = surrounding({
    candidate: record('new', 0, 360, 400), // 06:00-06:40
    existing: [
      record('sleep', 0, 300, 350, 'Sleeping'), // ends 05:50, before
      record('radio', 0, 370, 380, 'Radio'), // inside: music while dressing
      record('lunch', 0, 720, 780, 'Lunch'), // after
    ],
  });
  assert.deepEqual(
    rows(found).map((row) => row.kind),
    ['before', 'overlap', 'after']
  );
  assert.match(text(found), /^diary\.form\.neighbour\.before/);
  assert.match(text(found), /neighbour\.overlap\(name=Radio/);
  assert.match(text(found), /neighbour\.after\(name=Lunch/);
});

test('editing a row does not count the row against itself', () => {
  const found = surrounding({
    candidate: record('lunch', 0, 720, 780),
    existing: [record('lunch', 0, 720, 780, 'Lunch'), record('sleep', 0, 0, 360)],
    ignoreId: 'lunch',
  });
  assert.deepEqual(found.overlaps, []);
  assert.equal(found.before.name, 'sleep');
});

test('cross-midnight neighbours are found on the next day', () => {
  // Sleep 22:00 -> 08:00 (day 0, end spills into day 1), breakfast at 08:00.
  const found = surrounding({
    candidate: record('new', 0, 1320, 1920, 'Sleeping'),
    existing: [record('breakfast', 1, 480, 540, 'Breakfast')],
  });
  assert.deepEqual(found.after, { name: 'Breakfast', start: 1920 });
  assert.deepEqual(found.overlaps, []);

  // And a night activity that the candidate's tail runs into is an overlap.
  const clash = surrounding({
    candidate: record('new', 0, 1320, 1920),
    existing: [record('early', 1, 450, 540, 'Early bird')],
  });
  assert.equal(clash.overlaps.length, 1);
  assert.equal(clash.overlaps[0].minutes, 30);
});

test('the overlap range is printed in clock time, not raw minutes', () => {
  // The previous night runs 23:00 -> 01:00 (its end is past midnight), and the
  // new entry starts at 00:30 on the next day.
  const found = surrounding({
    candidate: record('new', 1, 30, 90),
    existing: [record('night', 0, 1380, 1500, 'Sleeping')],
  });
  assert.equal(found.overlaps.length, 1);
  assert.equal(found.overlaps[0].minutes, 30);
  assert.match(text(found), /range=00:30–01:00/);
});

test('a neighbour on another day names its weekday', () => {
  // A routine filled on all seven days: the entry after a Monday morning is
  // Tuesday's, and "ab 00:00" alone would read as today's midnight.
  const found = surrounding({
    candidate: record('new', 0, 540, 600),
    existing: [record('sleep', 0, 0, 540, 'Sleeping'), record('sleep-1', 1, 0, 540, 'Sleeping')],
  });
  assert.deepEqual(found.after, { name: 'Sleeping', start: 1440 });
  assert.equal(
    textWithDay(found),
    'diary.form.neighbour.before(name=Sleeping,time=09:00) · ' +
      'diary.form.neighbour.afterDay(name=Sleeping,day=day-1,time=00:00)'
  );
});

test('the same phrase on both sides stays two entries, not one range', () => {
  // Monday and Tuesday both hold "Sleeping 00:00-09:00". The hint must not read
  // as a single 33-hour block: it names each side, and the second one carries
  // the weekday.
  const found = surrounding({
    candidate: record('new', 0, 540, 600),
    existing: [record('mon', 0, 0, 540, 'Sleeping'), record('tue', 1, 0, 540, 'Sleeping')],
  });
  const line = textWithDay(found);
  assert.match(line, /before\(name=Sleeping,time=09:00\)/);
  assert.match(line, /afterDay\(name=Sleeping,day=day-1,time=00:00\)/);
  assert.equal(rowsWithDay(found).length, 2, 'two rows, not one range');
});

test('the previous entry can be on the previous day too', () => {
  const found = surrounding({
    candidate: record('new', 2, 600, 660),
    existing: [record('mon', 1, 0, 540, 'Sleeping')],
  });
  assert.equal(
    textWithDay(found),
    'diary.form.neighbour.beforeDay(name=Sleeping,day=day-1,time=09:00)'
  );
});

test('an overlap that leaves the day marks the range once', () => {
  // The candidate runs past midnight (23:00 -> 01:00) into Tuesday's entry.
  const found = surrounding({
    candidate: record('new', 0, 1380, 1500),
    existing: [record('tue', 1, 0, 120, 'Sleeping')],
  });
  assert.equal(found.overlaps.length, 1);
  assert.equal(found.overlaps[0].minutes, 60);
  assert.match(text(found), /range=00:00–01:00/);
  assert.match(textWithDay(found), /range=00:00–01:00 \(day-1\)/);
});

test('a boundary on another day is reported but never offered as a snap', () => {
  // The chip moves the start inside the form's own day, so a boundary before
  // midnight of the previous day cannot be reached by it.
  const found = surrounding({
    candidate: record('new', 1, 20, 80),
    existing: [record('night', 0, 1380, 1430, 'Sleeping')], // ends 23:50, 30 min earlier
  });
  assert.equal(found.before.name, 'Sleeping');
  assert.equal(found.snap, null);
});
