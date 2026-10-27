// @ts-check
/**
 * Pure day geometry: where a record goes on the page and how much of the day it
 * covers. No DOM, no network, no clock. See domain/time.js for the units.
 *
 * Nothing here decides whether a record is *allowed* - that is
 * domain/validation.js.
 */
import { MINUTES_PER_DAY } from './time.js';

export const MIN_GAP_MINUTES = 30;

/**
 * @typedef {Object} TimedRecord
 * @property {string} id
 * @property {number} dayIndex Index into the study's ordered day labels.
 * @property {number} startMinutes Minutes since the start of that day.
 * @property {number} endMinutes Exclusive end; may exceed 1440.
 */

/**
 * @typedef {Object} DaySegment
 * @property {TimedRecord} record
 * @property {number} start 0..1440, relative to this day's start.
 * @property {number} end 0..1440, exclusive.
 * @property {boolean} continuesAfter Ends after this day's midnight.
 * @property {boolean} continuesBefore Started on the previous day.
 * @property {number} lane 0-based lane inside its overlap cluster.
 * @property {number} laneCount Lanes used by that cluster, at least 1.
 */

/**
 * @typedef {Object} Interval
 * @property {number} start 0..1440
 * @property {number} end 0..1440, exclusive
 */

/** @param {number} minutes @param {number} hourPx @returns {number} */
export function minutesToPx(minutes, hourPx) {
  return (minutes / 60) * hourPx;
}

/** @param {number} px @param {number} hourPx @returns {number} */
export function pxToMinutes(px, hourPx) {
  return (px / hourPx) * 60;
}

/**
 * The parts of every record that are visible on one day, sorted in reading
 * order and tagged with whether they continue at either edge.
 *
 * A record belongs to the day it starts on (D6): its own day gets the head,
 * the next day gets the tail.
 *
 * @param {TimedRecord[]} records
 * @param {number} dayIndex
 * @returns {DaySegment[]}
 */
export function segmentsForDay(records, dayIndex) {
  /** @type {DaySegment[]} */
  const segments = [];

  for (const record of records) {
    if (!record || !Number.isFinite(record.startMinutes) || !Number.isFinite(record.endMinutes)) {
      continue;
    }
    if (record.dayIndex === dayIndex) {
      const start = Math.max(0, record.startMinutes);
      const end = Math.min(MINUTES_PER_DAY, record.endMinutes);
      if (end > start) {
        segments.push({
          record,
          start,
          end,
          continuesAfter: record.endMinutes > MINUTES_PER_DAY,
          continuesBefore: false,
          lane: 0,
          laneCount: 1,
        });
      }
    } else if (record.dayIndex === dayIndex - 1 && record.endMinutes > MINUTES_PER_DAY) {
      const end = Math.min(MINUTES_PER_DAY, record.endMinutes - MINUTES_PER_DAY);
      if (end > 0) {
        segments.push({
          record,
          start: 0,
          end,
          continuesAfter: false,
          continuesBefore: true,
          lane: 0,
          laneCount: 1,
        });
      }
    }
  }

  segments.sort((a, b) => a.start - b.start || b.end - a.end || a.record.id.localeCompare(b.record.id));
  return segments;
}

/**
 * Pack segments into lanes. Overlapping activities share the width; a cluster
 * is a run of segments that overlap transitively, and each cluster gets its own
 * lane count so a single overlap does not narrow the rest of the day.
 *
 * Returns new objects; the input is not modified.
 *
 * @param {DaySegment[]} segments Sorted by start, as returned by segmentsForDay.
 * @returns {DaySegment[]}
 */
export function assignLanes(segments) {
  /** @type {DaySegment[]} */
  const result = segments.map((segment) => ({ ...segment, lane: 0, laneCount: 1 }));

  /** @type {DaySegment[]} */
  let cluster = [];
  let clusterEnd = Number.NEGATIVE_INFINITY;

  const closeCluster = () => {
    /** @type {number[]} */
    const laneEnds = [];
    for (const segment of cluster) {
      let lane = laneEnds.findIndex((end) => end <= segment.start);
      if (lane === -1) {
        lane = laneEnds.length;
        laneEnds.push(0);
      }
      laneEnds[lane] = segment.end;
      segment.lane = lane;
    }
    const laneCount = Math.max(1, laneEnds.length);
    for (const segment of cluster) segment.laneCount = laneCount;
    cluster = [];
  };

  for (const segment of result) {
    if (cluster.length > 0 && segment.start >= clusterEnd) {
      closeCluster();
      clusterEnd = Number.NEGATIVE_INFINITY;
    }
    cluster.push(segment);
    clusterEnd = Math.max(clusterEnd, segment.end);
  }
  if (cluster.length > 0) closeCluster();

  return result;
}

/**
 * Merge segments into disjoint intervals, clipped to the day.
 *
 * @param {Interval[]} intervals
 * @returns {Interval[]}
 */
export function mergeIntervals(intervals) {
  const sorted = intervals
    .filter((interval) => interval.end > interval.start)
    .map((interval) => ({ start: interval.start, end: interval.end }))
    .sort((a, b) => a.start - b.start);

  /** @type {Interval[]} */
  const merged = [];
  for (const interval of sorted) {
    const last = merged[merged.length - 1];
    if (last && interval.start <= last.end) {
      if (interval.end > last.end) last.end = interval.end;
    } else {
      merged.push(interval);
    }
  }
  return merged;
}

/**
 * Covered time for one day: the union of the segments, so two parallel
 * activities never count twice (D20).
 *
 * @param {DaySegment[]} segments
 * @returns {number} Minutes covered, 0..1440.
 */
export function coverageMinutes(segments) {
  return mergeIntervals(segments).reduce((total, interval) => total + (interval.end - interval.start), 0);
}

/**
 * Empty stretches between activities on a day that has activities.
 *
 * Deliberately no leading or trailing gap: an empty morning is not a gap
 * between two activities, and an empty day is not 24 gaps (D28).
 *
 * @param {DaySegment[]} segments
 * @param {{ minMinutes?: number }} [options]
 * @returns {Interval[]}
 */
export function gapsForDay(segments, options = {}) {
  const { minMinutes = MIN_GAP_MINUTES } = options;
  const merged = mergeIntervals(segments);

  /** @type {Interval[]} */
  const gaps = [];
  for (let index = 1; index < merged.length; index += 1) {
    const start = merged[index - 1].end;
    const end = merged[index].start;
    if (end - start >= minMinutes) gaps.push({ start, end });
  }
  return gaps;
}

/**
 * Everything the timeline renderer needs for one day, in one call.
 *
 * @param {TimedRecord[]} records
 * @param {number} dayIndex
 * @param {{ minGapMinutes?: number }} [options]
 * @returns {{ segments: DaySegment[], coverage: number, gaps: Interval[] }}
 */
export function layoutDay(records, dayIndex, options = {}) {
  const segments = assignLanes(segmentsForDay(records, dayIndex));
  return {
    segments,
    coverage: coverageMinutes(segments),
    gaps: gapsForDay(segments, { minMinutes: options.minGapMinutes }),
  };
}
