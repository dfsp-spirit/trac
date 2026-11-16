// @ts-check
/**
 * The review screen's data (D32): every day in order, its activities in time
 * order, and whether the diary may be submitted.
 *
 * Pure, like the rest of domain/. It returns numbers and record references,
 * never prose: the modal decides what to say. That keeps the "can I submit?"
 * rule testable without a DOM, and it is the same rule the service applies.
 */
import { dayLabel, daySummaries, layoutForDay, timedActivities } from './diary.js';
import { MINUTES_PER_DAY } from './time.js';

/**
 * One line of a day: an entry the participant placed, the part of an entry from
 * the day before that reaches into this day, or a stretch with nothing in it.
 *
 * The reading order is the timeline's, so the review cannot show a day that looks
 * different from what the participant built (D32).
 *
 * @typedef {Object} ReviewRow
 * @property {'activity' | 'continued' | 'gap'} kind
 * @property {string} id
 * @property {number} start Day-relative minutes, clipped to this day for `continued`.
 * @property {number} end Day-relative minutes; past 1440 when an activity runs over.
 * @property {boolean} nextDay True when the activity ends after midnight.
 * @property {string} name Empty for a gap.
 * @property {string | null} color
 */

/**
 * @typedef {Object} ReviewDay
 * @property {number} index
 * @property {string} name
 * @property {string} label
 * @property {number} coverage
 * @property {number} minutesToGo 0 when the day is complete.
 * @property {boolean} meets
 * @property {ReviewRow[]} rows
 */

/**
 * @typedef {Object} Review
 * @property {ReviewDay[]} days
 * @property {number[]} incomplete Days that are not complete yet, in day order.
 * @property {string[]} incompleteLabels Their names, for the message that says
 *   which days still need minutes.
 * @property {number} completeDays
 * @property {number} totalDays
 * @property {boolean} canSubmit
 */

/**
 * @param {import('./diary.js').ApiDiary} diary
 * @param {string} language
 * @returns {Review}
 */
export function review(diary, language) {
  const records = timedActivities(diary);
  const required = diary.timeline.min_coverage || 0;
  /** @type {Map<string, import('./diary.js').ApiActivity>} */
  const byId = new Map(diary.activities.map((activity) => [activity.client_uuid, activity]));

  const days = daySummaries(diary).map((summary) => {
    const layout = layoutForDay(diary, summary.index);
    const own = records
      .filter((record) => record.dayIndex === summary.index)
      .sort((a, b) => a.startMinutes - b.startMinutes || a.endMinutes - b.endMinutes)
      .map((record) => rowFor(record, byId.get(record.id)));
    const continued = layout.segments
      .filter((segment) => segment.continuesBefore)
      .map((segment) => continuedRow(segment, byId.get(segment.record.id)));
    const gaps = layout.gaps.map((gap) => gapRow(gap, summary.index));
    const rows = [...continued, ...own, ...gaps].sort(
      (a, b) => a.start - b.start || ORDER[a.kind] - ORDER[b.kind]
    );

    return {
      index: summary.index,
      name: summary.name,
      label: dayLabel(summary, language),
      coverage: summary.coverage,
      minutesToGo: Math.max(0, required - summary.coverage),
      meets: summary.meets,
      rows,
    };
  });

  const open = days.filter((day) => !day.meets);
  const incomplete = open.map((day) => day.index);

  return {
    days,
    incomplete,
    incompleteLabels: open.map((day) => day.label),
    completeDays: days.length - incomplete.length,
    totalDays: days.length,
    canSubmit: days.length > 0 && incomplete.length === 0,
  };
}

/** At the same minute, the continuation comes first: it is the earlier story. */
const ORDER = /** @type {const} */ ({ continued: 0, activity: 1, gap: 2 });

/**
 * @param {import('./geometry.js').TimedRecord} record
 * @param {import('./diary.js').ApiActivity | undefined} activity
 * @returns {ReviewRow}
 */
function rowFor(record, activity) {
  return {
    kind: 'activity',
    id: record.id,
    start: record.startMinutes,
    end: record.endMinutes,
    // Strictly past the end of the day: an entry that stops at 00:00 ends the
    // day, it does not reach into the next one (the timeline draws no ↓ either).
    nextDay: record.endMinutes > MINUTES_PER_DAY,
    name: activity?.activity_name ?? '',
    color: activity?.color ?? null,
  };
}

/**
 * The visible part of an entry that started the day before. Without it a day can
 * show "840 minutes still to add" while its list appears to begin at 09:00.
 *
 * @param {import('./geometry.js').DaySegment} segment
 * @param {import('./diary.js').ApiActivity | undefined} activity
 * @returns {ReviewRow}
 */
function continuedRow(segment, activity) {
  return {
    kind: 'continued',
    id: segment.record.id,
    start: segment.start,
    end: segment.end,
    nextDay: false,
    name: activity?.activity_name ?? '',
    color: activity?.color ?? null,
  };
}

/**
 * @param {import('./geometry.js').Interval} gap
 * @param {number} dayIndex
 * @returns {ReviewRow}
 */
function gapRow(gap, dayIndex) {
  return {
    kind: 'gap',
    id: `gap:${dayIndex}:${gap.start}`,
    start: gap.start,
    end: gap.end,
    nextDay: false,
    name: '',
    color: null,
  };
}
