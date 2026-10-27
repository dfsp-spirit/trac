// @ts-check
/**
 * The review screen's data (D32): every day in order, its activities in time
 * order, and whether the diary may be submitted.
 *
 * Pure, like the rest of domain/. It returns numbers and record references,
 * never prose: the modal decides what to say. That keeps the "can I submit?"
 * rule testable without a DOM, and it is the same rule the service applies.
 */
import { dayLabel, daySummaries, timedActivities } from './diary.js';
import { dayOffset } from './time.js';

/**
 * @typedef {Object} ReviewRow
 * @property {string} id
 * @property {number} start Day-relative minutes.
 * @property {number} end Day-relative minutes; past 1440 when it runs over.
 * @property {boolean} nextDay True when the activity ends after midnight.
 * @property {string} name
 * @property {string | null} detail Second line, when the category adds something.
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
    const rows = records
      .filter((record) => record.dayIndex === summary.index)
      .sort((a, b) => a.startMinutes - b.startMinutes || a.endMinutes - b.endMinutes)
      .map((record) => rowFor(record, byId.get(record.id)));

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

/**
 * @param {import('./geometry.js').TimedRecord} record
 * @param {import('./diary.js').ApiActivity | undefined} activity
 * @returns {ReviewRow}
 */
function rowFor(record, activity) {
  const category = activity?.category ?? null;
  const name = activity?.activity_name ?? '';
  return {
    id: record.id,
    start: record.startMinutes,
    end: record.endMinutes,
    nextDay: dayOffset(record.endMinutes) > dayOffset(record.startMinutes),
    name,
    detail: category && category !== name ? category : null,
    color: activity?.color ?? null,
  };
}
