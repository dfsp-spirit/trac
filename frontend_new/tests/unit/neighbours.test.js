import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  SNAP_MAX_MINUTES,
  neighbourText,
  surrounding,
} from '../../src/js/domain/neighbours.js';

// The boundary hint under the activity form. It exists because the phone form
// covers the timeline, and it must report *boundaries* (what ends where), never
// history (what was added last). The tolerated-overlap case is the reason it is
// not just a nicety: `max_overlap` lets one overlap through silently.

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

function text(found) {
  return neighbourText(found, translator, clock, short);
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
  assert.equal(text(found), null);
});

test('the previous entry names the boundary the participant forgot', () => {
  const found = surrounding({
    candidate: record('new', 0, 370, 400), // guessed 06:10
    existing: [record('sleep', 0, 0, 360, 'Sleeping')], // actually until 06:00
  });
  assert.deepEqual(found.before, { name: 'Sleeping', end: 360 });
  assert.equal(found.after, null);
  assert.equal(
    text(found),
    'diary.form.neighbour.before(name=Sleeping,time=06:00)'
  );
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

test('the overlap message wins over the boundary message', () => {
  const found = surrounding({
    candidate: record('new', 0, 360, 400),
    existing: [
      record('sleep', 0, 0, 370, 'Sleeping'),
      record('lunch', 0, 720, 780, 'Lunch'),
    ],
  });
  assert.match(text(found) || '', /^diary\.form\.neighbour\.overlap/);
  assert.ok(!(text(found) || '').includes('neighbour.after'));
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
  assert.match(text(found) || '', /range=00:30–01:00/);
});
