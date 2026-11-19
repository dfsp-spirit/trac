// @ts-check
/**
 * The review screen's data (D32): every day in order, the covered stretches its
 * strip draws, the one hole worth pointing at, and whether the diary may be
 * submitted.
 *
 * Pure, like the rest of domain/. It returns numbers and record references,
 * never prose: the modal decides what to say. That keeps the "can I submit?"
 * rule testable without a DOM, and it is the same rule the service applies.
 */
import { dayLabel, daySummaries } from './diary.js';
import { MIN_GAP_MINUTES, uncoveredIntervals } from './geometry.js';

/**
 * @typedef {Object} ReviewDay
 * @property {number} index
 * @property {string} name
 * @property {string} label
 * @property {number} coverage
 * @property {Array<{ start: number, end: number }>} runs Covered stretches, for the strip.
 * @property {{ start: number, end: number } | null} largestGap Longest stretch with
 *   nothing recorded, when the day is open and has data. Null otherwise.
 * @property {number} minutesToGo 0 when the day is complete.
 * @property {boolean} meets
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
  const required = diary.timeline.min_coverage || 0;

  const days = daySummaries(diary).map((summary) => {
    return {
      index: summary.index,
      name: summary.name,
      label: dayLabel(summary, language),
      coverage: summary.coverage,
      runs: summary.runs,
      largestGap: largestGapFor(summary),
      minutesToGo: Math.max(0, required - summary.coverage),
      meets: summary.meets,
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
 * The longest hole of a day, when pointing at one is useful: the day is open
 * and has entries, and the hole is at least a gap (not a few stray minutes the
 * participant cannot place anything in).
 *
 * Leading and trailing holes count - an empty evening is exactly what the
 * review should point at - which is why this is not `layoutDay().gaps`.
 *
 * @param {{ meets: boolean, hasData: boolean, runs: Array<{ start: number, end: number }> }} summary
 * @returns {{ start: number, end: number } | null}
 */
function largestGapFor(summary) {
  if (summary.meets || !summary.hasData) return null;

  /** @type {{ start: number, end: number } | null} */
  let largest = null;
  for (const hole of uncoveredIntervals(summary.runs)) {
    if (hole.end - hole.start < MIN_GAP_MINUTES) continue;
    if (!largest || hole.end - hole.start > largest.end - largest.start) {
      largest = hole;
    }
  }
  return largest;
}
