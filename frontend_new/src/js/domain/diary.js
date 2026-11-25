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
import { layoutDay, mergeIntervals } from './geometry.js';

/**
 * @typedef {Object} ApiActivity
 * @property {string} client_uuid
 * @property {string | null} [group_id]
 * @property {number} day_label_index
 * @property {string | null} [timeline_key] Which timeline the row sits on.
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
 * @property {{
 *   name_short: string, name: string, default_language: string,
 *   day_start_minutes: number, num_recent_activities_shown: number,
 *   time_step_minutes?: number, min_duration_minutes?: number,
 *   submitted_at: string | null,
 * }} study
 * @property {{ key: string, display_name?: string, min_coverage: number | null, max_overlap: number }} timeline
 * @property {Array<{ index: number, name: string, display_name: string, display_names: Record<string, string>, has_data: boolean, coverage_minutes: number, meets_requirement: boolean }>} days
 * @property {Array<{ key: string, names: Record<string, string>, day_indexes: number[] }>} day_groups
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
 * Every activity of the diary with the colour it carries, for the coloured day
 * strip (`ui/dayStrip.js`): the review page and the day rail must draw the same
 * picture, so both mount these records instead of mapping them themselves.
 *
 * @param {ApiDiary} diary
 * @returns {Array<import('./geometry.js').TimedRecord & { color: string | null }>}
 */
export function colouredActivities(diary) {
  const dayStart = diary.study.day_start_minutes || 0;
  return diary.activities.map((activity) => ({
    ...toTimedActivity(activity, dayStart),
    color: activity.color ?? null,
  }));
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
 * @returns {Array<{ index: number, name: string, displayName: string, displayNames: Record<string, string>, coverage: number, runs: Array<{ start: number, end: number }>, hasData: boolean, meets: boolean, activities: number }>}
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
      // The union of the day's covered intervals, clipped to the day. The rail
      // draws these as one row, so parallel or touching activities must not
      // leave a seam the day does not have.
      runs: mergeIntervals(layout.segments),
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
 * fallback. One function, so the rail, the review, the form and the timeline
 * cannot disagree about what a day is called.
 *
 * Accepts both shapes the app holds: an API row (`display_name` /
 * `display_names`) and a `daySummaries()` entry (`displayName` /
 * `displayNames`). Reading only one of them is how the day chips ended up
 * showing the internal English name ("mo", "tu") to German participants.
 *
 * @param {{ name: string, displayName?: string | null, displayNames?: Record<string, string>, display_name?: string | null, display_names?: Record<string, string> }} day
 * @param {string} language
 * @returns {string}
 */
export function dayLabel(day, language) {
  const names = day.displayNames || day.display_names || {};
  return names[language] || day.displayName || day.display_name || day.name;
}

/**
 * Pick a study-supplied localized label: the interface language, then the
 * study's default language, then English, then whatever the config has.
 *
 * Study content (day groups, for instance) is not app translation - it only has
 * the languages the researcher wrote - so a missing language must degrade to a
 * readable label instead of an empty button.
 *
 * @param {Record<string, string> | null | undefined} names
 * @param {string} language
 * @param {string | null | undefined} defaultLanguage
 * @returns {string}
 */
export function localizedText(names, language, defaultLanguage) {
  const map = names || {};
  for (const candidate of [language, defaultLanguage, 'en']) {
    const text = candidate ? map[candidate] : '';
    if (typeof text === 'string' && text.trim()) return text;
  }
  const first = Object.values(map).find(
    (text) => typeof text === 'string' && text.trim()
  );
  return typeof first === 'string' ? first : '';
}

/**
 * Several days as one phrase ("Di, Sa"), in ascending order, for the messages
 * that name days instead of pointing at the timeline.
 *
 * @param {number[]} indexes
 * @param {Array<{ index: number, name: string, displayName?: string | null, displayNames?: Record<string, string>, display_name?: string | null, display_names?: Record<string, string> }>} days
 * @param {string} language
 * @returns {string}
 */
export function dayLabelList(indexes, days, language) {
  const byIndex = new Map(days.map((day) => [day.index, day]));
  return [...new Set(indexes)]
    .sort((a, b) => a - b)
    .map((index) => {
      const day = byIndex.get(index);
      return day ? dayLabel(day, language) : String(index);
    })
    .join(', ');
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
