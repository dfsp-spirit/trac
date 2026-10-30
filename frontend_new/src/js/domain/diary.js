// @ts-check
/**
 * Adapters between the diary API payload and the pure domain.
 *
 * The API speaks clock minutes and day-label indexes; the domain speaks
 * day-relative minutes and day indexes. This file is the only place that
 * translates, so a study with a shifted day window (`day_start_minutes`) needs
 * no special case anywhere else.
 *
 * Nothing here mutates the payload.
 */
import { MINUTES_PER_DAY, toDayRelative } from './time.js';
import { layoutDay } from './geometry.js';

/**
 * @typedef {Object} ApiActivity
 * @property {string} client_uuid
 * @property {string | null} [group_id]
 * @property {number} day_label_index
 * @property {number} activity_code
 * @property {string} activity_name
 * @property {string | null} [category]
 * @property {string | null} [color]
 * @property {number | null} [parent_activity_code]
 * @property {string | null} [frequency_key]
 * @property {number} start_minutes
 * @property {number} end_minutes
 * @property {string | null} [created_at]
 * @property {string | null} [updated_at]
 */

/**
 * @typedef {Object} ApiDiary
 * @property {number} schema_version
 * @property {{ day_start_minutes: number, submitted_at: string | null }} study
 * @property {{ min_coverage: number | null, max_overlap: number }} timeline
 * @property {Array<{ index: number, name: string, display_name: string, display_names: Record<string, string>, has_data: boolean, coverage_minutes: number, meets_requirement: boolean }>} days
 * @property {ApiActivity[]} activities
 */

/**
 * @param {ApiActivity} activity
 * @param {number} dayStartMinutes
 * @returns {import('./geometry.js').TimedRecord}
 */
export function toTimedActivity(activity, dayStartMinutes) {
  const startMinutes = toDayRelative(activity.start_minutes, dayStartMinutes);
  let endMinutes = toDayRelative(activity.end_minutes, dayStartMinutes);
  if (endMinutes <= startMinutes) endMinutes += MINUTES_PER_DAY;
  return {
    id: activity.client_uuid,
    dayIndex: activity.day_label_index,
    startMinutes,
    endMinutes,
  };
}

/**
 * @param {ApiDiary} diary
 * @returns {import('./geometry.js').TimedRecord[]}
 */
export function timedActivities(diary) {
  const dayStart = diary.study.day_start_minutes || 0;
  return diary.activities.map((activity) => toTimedActivity(activity, dayStart));
}

/**
 * Lanes, coverage and gaps for one day.
 *
 * @param {ApiDiary} diary
 * @param {number} dayIndex
 * @returns {ReturnType<typeof layoutDay>}
 */
export function layoutForDay(diary, dayIndex) {
  return layoutDay(timedActivities(diary), dayIndex);
}

/**
 * Does a day satisfy its requirement? Mirrors `coverage.day_meets_requirements`
 * on the server, so the rail and the submit gate agree.
 *
 * @param {{ coverage: number, hasData: boolean }} summary
 * @param {number | null} minCoverage
 * @returns {boolean}
 */
export function meetsRequirement(summary, minCoverage) {
  const required = minCoverage || 0;
  if (!summary.hasData) return false;
  return summary.coverage >= required;
}

/**
 * The per-day numbers the rail and the panel show. Computed locally from the
 * activities, so an optimistic edit updates them without a round trip.
 *
 * @param {ApiDiary} diary
 * @returns {Array<{ index: number, name: string, displayName: string, displayNames: Record<string, string>, coverage: number, hasData: boolean, meets: boolean, activities: number }>}
 */
export function daySummaries(diary) {
  const records = timedActivities(diary);
  const minCoverage = diary.timeline.min_coverage;

  return diary.days.map((day) => {
    const layout = layoutDay(records, day.index);
    const summary = {
      index: day.index,
      name: day.name,
      displayName: day.display_name,
      displayNames: day.display_names || {},
      coverage: layout.coverage,
      hasData: layout.segments.length > 0,
      meets: false,
      activities: layout.segments.length,
    };
    summary.meets = meetsRequirement(summary, minCoverage);
    return summary;
  });
}

/**
 * The create payload that puts an existing activity back exactly as it was.
 *
 * Used by undo: the row is recreated with the same times, name and colour, under
 * a fresh client id, so the server treats it as a new activity rather than a
 * duplicate of the row that was just deleted.
 *
 * @param {ApiActivity} activity
 * @param {string} clientUuid
 * @returns {Record<string, unknown>}
 */
export function toCreateItem(activity, clientUuid) {
  return {
    client_uuid: clientUuid,
    activity_code: activity.activity_code,
    activity_name: activity.activity_name,
    category: activity.category,
    color: activity.color,
    parent_activity_code: activity.parent_activity_code,
    frequency_key: activity.frequency_key,
    start_minutes: activity.start_minutes,
    end_minutes: activity.end_minutes,
    day_label_indexes: [activity.day_label_index],
  };
}

/**
 * The day's name in the interface language, with the study's default as the
 * fallback. One function, so the rail, the review and the timeline cannot
 * disagree about what a day is called.
 *
 * @param {{ name: string, displayName?: string | null, displayNames?: Record<string, string> }} day
 * @param {string} language
 * @returns {string}
 */
export function dayLabel(day, language) {
  return (day.displayNames && day.displayNames[language]) || day.displayName || day.name;
}

/**
 * How many days meet their requirement, for the top bar.
 *
 * @param {ApiDiary} diary
 * @returns {{ done: number, total: number }}
 */
export function progress(diary) {
  const summaries = daySummaries(diary);
  return {
    done: summaries.filter((summary) => summary.meets).length,
    total: summaries.length,
  };
}
