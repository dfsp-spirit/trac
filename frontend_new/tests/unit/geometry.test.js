import { test } from 'node:test';
import assert from 'node:assert/strict';
import { MINUTES_PER_DAY } from '../../src/js/domain/time.js';
import {
  assignLanes,
  coverageMinutes,
  gapsForDay,
  layoutDay,
  mergeIntervals,
  minutesToPx,
  pxToMinutes,
  segmentsForDay,
} from '../../src/js/domain/geometry.js';

/** @param {Partial<{ id: string, dayIndex: number, startMinutes: number, endMinutes: number }>} overrides */
function rec(overrides = {}) {
  return { id: 'a', dayIndex: 0, startMinutes: 0, endMinutes: 60, ...overrides };
}

test('minutesToPx and pxToMinutes use the hour row, not a step size', () => {
  assert.equal(minutesToPx(60, 64), 64);
  assert.equal(minutesToPx(30, 64), 32);
  assert.equal(pxToMinutes(32, 64), 30);
  assert.equal(pxToMinutes(minutesToPx(17, 64), 64), 17);
});

test('segmentsForDay keeps a record on its own day and clips it at midnight', () => {
  const segments = segmentsForDay([rec({ startMinutes: 1320, endMinutes: 1920 })], 0);
  assert.equal(segments.length, 1);
  assert.equal(segments[0].start, 1320);
  assert.equal(segments[0].end, MINUTES_PER_DAY);
  assert.equal(segments[0].continuesAfter, true);
  assert.equal(segments[0].continuesBefore, false);
});

test('segmentsForDay draws the tail of a cross-midnight record on the next day', () => {
  const record = rec({ startMinutes: 1320, endMinutes: 1920 });
  const next = segmentsForDay([record], 1);
  assert.equal(next.length, 1);
  assert.equal(next[0].start, 0);
  assert.equal(next[0].end, 480);
  assert.equal(next[0].continuesBefore, true);
  assert.equal(next[0].continuesAfter, false);
  assert.equal(next[0].record, record, 'both parts open the same record');
});

test('segmentsForDay does not invent a tail on the day after next', () => {
  const record = rec({ startMinutes: 1320, endMinutes: 1920 });
  assert.deepEqual(segmentsForDay([record], 2), []);
});

test('segmentsForDay ignores other days and degenerate ranges', () => {
  const records = [
    rec({ id: 'monday', dayIndex: 0 }),
    rec({ id: 'wednesday', dayIndex: 2 }),
    rec({ id: 'zero', startMinutes: 100, endMinutes: 100 }),
    rec({ id: 'broken', startMinutes: Number.NaN, endMinutes: 30 }),
  ];
  const ids = segmentsForDay(records, 0).map((segment) => segment.record.id);
  assert.deepEqual(ids, ['monday']);
});

test('segmentsForDay sorts by start, then longest first, then id', () => {
  const records = [
    rec({ id: 'late', startMinutes: 600, endMinutes: 660 }),
    rec({ id: 'b', startMinutes: 300, endMinutes: 360 }),
    rec({ id: 'a-long', startMinutes: 300, endMinutes: 480 }),
  ];
  const ids = segmentsForDay(records, 0).map((segment) => segment.record.id);
  assert.deepEqual(ids, ['a-long', 'b', 'late']);
});

test('assignLanes puts non-overlapping activities in lane 0 of their own cluster', () => {
  const segments = segmentsForDay(
    [rec({ id: 'one', startMinutes: 0, endMinutes: 60 }), rec({ id: 'two', startMinutes: 60, endMinutes: 120 })],
    0
  );
  const lanes = assignLanes(segments);
  assert.deepEqual(
    lanes.map((segment) => [segment.lane, segment.laneCount]),
    [
      [0, 1],
      [0, 1],
    ]
  );
});

test('assignLanes gives overlapping activities separate lanes', () => {
  const segments = segmentsForDay(
    [
      rec({ id: 'a', startMinutes: 0, endMinutes: 120 }),
      rec({ id: 'b', startMinutes: 30, endMinutes: 90 }),
      rec({ id: 'c', startMinutes: 60, endMinutes: 180 }),
    ],
    0
  );
  const lanes = assignLanes(segments);
  assert.deepEqual(
    lanes.map((segment) => [segment.record.id, segment.lane, segment.laneCount]),
    [
      ['a', 0, 3],
      ['b', 1, 3],
      ['c', 2, 3],
    ]
  );
});

test('assignLanes gives a following activity full width once the overlap ends', () => {
  const segments = segmentsForDay(
    [
      rec({ id: 'a', startMinutes: 0, endMinutes: 60 }),
      rec({ id: 'b', startMinutes: 0, endMinutes: 60 }),
      rec({ id: 'c', startMinutes: 60, endMinutes: 120 }),
    ],
    0
  );
  const lanes = assignLanes(segments);
  assert.deepEqual(
    lanes.map((segment) => [segment.record.id, segment.lane, segment.laneCount]),
    [
      ['a', 0, 2],
      ['b', 1, 2],
      ['c', 0, 1],
    ],
    'c starts a new cluster because nothing overlaps it, so it is full width'
  );
});

test('assignLanes keeps clusters independent so one overlap does not narrow the day', () => {
  const segments = segmentsForDay(
    [
      rec({ id: 'a', startMinutes: 0, endMinutes: 100 }),
      rec({ id: 'b', startMinutes: 10, endMinutes: 100 }),
      rec({ id: 'c', startMinutes: 300, endMinutes: 400 }),
    ],
    0
  );
  const lanes = assignLanes(segments);
  assert.deepEqual(
    lanes.map((segment) => [segment.record.id, segment.laneCount]),
    [
      ['a', 2],
      ['b', 2],
      ['c', 1],
    ]
  );
});

test('assignLanes does not modify its input', () => {
  const segments = segmentsForDay([rec({ startMinutes: 0, endMinutes: 60 })], 0);
  assignLanes(segments);
  assert.equal(segments[0].laneCount, 1);
});

test('mergeIntervals merges touching and nested intervals', () => {
  assert.deepEqual(
    mergeIntervals([
      { start: 60, end: 120 },
      { start: 0, end: 60 },
      { start: 20, end: 40 },
    ]),
    [{ start: 0, end: 120 }]
  );
  assert.deepEqual(mergeIntervals([]), []);
  assert.deepEqual(mergeIntervals([{ start: 10, end: 10 }]), []);
});

test('coverageMinutes counts parallel activities once', () => {
  const segments = assignLanes(
    segmentsForDay(
      [
        rec({ id: 'a', startMinutes: 0, endMinutes: 120 }),
        rec({ id: 'b', startMinutes: 60, endMinutes: 180 }),
      ],
      0
    )
  );
  assert.equal(coverageMinutes(segments), 180, 'union of 0-120 and 60-180');
});

test('coverageMinutes splits a cross-midnight record between the two days', () => {
  const record = rec({ startMinutes: 1320, endMinutes: 1920 });
  assert.equal(coverageMinutes(segmentsForDay([record], 0)), 120, '22:00 to midnight');
  assert.equal(coverageMinutes(segmentsForDay([record], 1)), 480, 'midnight to 08:00');
});

test('coverageMinutes of a fully covered day is 1440 and never more', () => {
  const segments = assignLanes(
    segmentsForDay(
      [
        rec({ id: 'a', startMinutes: 0, endMinutes: 1440 }),
        rec({ id: 'b', startMinutes: 0, endMinutes: 1440 }),
        rec({ id: 'c', startMinutes: 0, endMinutes: 1440 }),
      ],
      0
    )
  );
  assert.equal(coverageMinutes(segments), MINUTES_PER_DAY);
});

test('gapsForDay reports only stretches between activities', () => {
  const segments = segmentsForDay(
    [
      rec({ id: 'a', startMinutes: 480, endMinutes: 540 }),
      rec({ id: 'b', startMinutes: 600, endMinutes: 660 }),
    ],
    0
  );
  assert.deepEqual(gapsForDay(segments), [{ start: 540, end: 600 }]);
});

test('gapsForDay has no leading or trailing gap and respects the threshold', () => {
  const segments = segmentsForDay(
    [
      rec({ id: 'a', startMinutes: 480, endMinutes: 540 }),
      rec({ id: 'b', startMinutes: 560, endMinutes: 660 }),
    ],
    0
  );
  assert.deepEqual(gapsForDay(segments), [], 'a 20-minute gap is below the 30-minute floor');
  assert.deepEqual(gapsForDay(segments, { minMinutes: 0 }), [{ start: 540, end: 560 }]);
  assert.deepEqual(gapsForDay(segmentsForDay([rec()], 0)), [], 'no trailing gap on a sparse day');
});

test('gapsForDay ignores gaps that are covered by a parallel activity', () => {
  const segments = segmentsForDay(
    [
      rec({ id: 'a', startMinutes: 480, endMinutes: 540 }),
      rec({ id: 'b', startMinutes: 540, endMinutes: 660 }),
      rec({ id: 'c', startMinutes: 500, endMinutes: 600 }),
    ],
    0
  );
  assert.deepEqual(gapsForDay(segments), []);
});

test('layoutDay returns lanes, coverage and gaps for one day', () => {
  const records = [
    rec({ id: 'a', startMinutes: 0, endMinutes: 480 }),
    rec({ id: 'b', startMinutes: 480, endMinutes: 540 }),
    rec({ id: 'c', startMinutes: 600, endMinutes: 660 }),
  ];
  const layout = layoutDay(records, 0);
  assert.equal(layout.segments.length, 3);
  assert.equal(layout.coverage, 600);
  assert.deepEqual(layout.gaps, [{ start: 540, end: 600 }]);
});
