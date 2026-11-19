// @ts-check
/**
 * Copying a whole day onto other days (D18, D19).
 *
 * The rules have to answer one question per target day: "would the copied rows
 * be accepted there?" They are the same rules as a multi-day create, with two
 * differences that come from copying rather than adding:
 *
 *  * the target's own rows are *replaced*, so they do not count as neighbours -
 *    but the tail of the day before and the rows of the day after still do;
 *  * the rows come from the database, so their times are already valid. There is
 *    no step or duration check here, and nothing is "snapped".
 *
 * The server applies the same rules; this module exists so the dialog can say
 * what will happen before anything is written (and so the answer is testable
 * without a browser).
 */
import { timedActivities, toTimedActivity } from './diary.js';
import { MINUTES_PER_DAY, STEP_MINUTES } from './time.js';
import { Codes, overlapViolation } from './validation.js';

/**
 * @typedef {import('./validation.js').CodedRecord} CodedRecord
 * @typedef {import('./diary.js').ApiDiary} ApiDiary
 *
 * @typedef {Object} CopyTarget
 * @property {number} dayIndex
 * @property {'copied' | 'skipped'} status
 * @property {string} [code] Why the day was refused, from Codes.
 * @property {Record<string, unknown>} [meta] The refusal's details (overlap minute).
 * @property {number} adds Rows the copy puts on the day.
 * @property {number} replaces Rows already on the day that the copy removes.
 *
 * @typedef {Object} CopySource
 * @property {number} count Entries attributed to the day.
 * @property {?number} firstStart Day-relative minute of the first start.
 * @property {?number} lastEnd Day-relative minute of the last end.
 */

/**
 * How many entries each day owns. A row belongs to the day it starts on, so a
 * night entry is counted on its own day and not on the one it runs into.
 *
 * @param {ApiDiary} diary
 * @returns {Map<number, number>}
 */
export function ownCounts(diary) {
  /** @type {Map<number, number>} */
  const counts = new Map();
  for (const activity of diary.activities) {
    const day = Number(activity.day_label_index);
    counts.set(day, (counts.get(day) || 0) + 1);
  }
  return counts;
}

/**
 * The days a participant could copy *from*: the ones that own at least one row.
 *
 * Deliberately not `hasData`: a day whose only content is the tail of the
 * previous day's night entry looks filled but has nothing to copy.
 *
 * @param {ApiDiary} diary
 * @returns {number[]}
 */
export function copyableDays(diary) {
  return [...ownCounts(diary).keys()].sort((a, b) => a - b);
}

/**
 * The names a day may carry in the study config for the two shortcut groups.
 * Only the stable `name` is read - display names are free text and may say
 * anything. The list covers the names the shipped configs use, the two-letter
 * form older models were created with, and the full German/Swedish weekdays, so
 * a translated config still classifies.
 */
const WORKDAY_ALIASES = new Set([
  'monday', 'mon', 'mo', 'montag', 'måndag', 'mandag',
  'tuesday', 'tue', 'tues', 'tu', 'dienstag', 'tisdag', 'di',
  'wednesday', 'wed', 'we', 'mittwoch', 'onsdag', 'mi',
  'thursday', 'thu', 'thur', 'thurs', 'th', 'donnerstag', 'torsdag', 'do',
  'friday', 'fri', 'fr', 'freitag', 'fredag',
]);
const WEEKEND_ALIASES = new Set([
  'saturday', 'sat', 'sa', 'samstag', 'lördag', 'lordag',
  'sunday', 'sun', 'su', 'sonntag', 'söndag', 'sondag', 'so',
]);

/**
 * The study's days split into work days (Mon-Fri) and the weekend, for the copy
 * dialog's one-click target presets.
 *
 * Returns null when a day cannot be recognised: a study with custom day names
 * gets no shortcuts rather than a preset that silently leaves a day out. The
 * caller still shows the individual chips, so nothing becomes unreachable.
 *
 * @param {Array<{ index: number, name: string }>} days
 * @returns {{ workdays: number[], weekend: number[] } | null}
 */
export function weekdayGroups(days) {
  if (!Array.isArray(days) || !days.length) return null;

  /** @type {{ workdays: number[], weekend: number[] }} */
  const groups = { workdays: [], weekend: [] };
  for (const day of days) {
    const name = String(day?.name ?? '').trim().toLowerCase().replace(/\.$/, '');
    if (WORKDAY_ALIASES.has(name)) groups.workdays.push(day.index);
    else if (WEEKEND_ALIASES.has(name)) groups.weekend.push(day.index);
    else return null;
  }
  return groups;
}

/**
 * What the source day would contribute: how many entries, and the span they
 * cover on the day-relative axis (the day's own window, not the wall clock).
 *
 * @param {ApiDiary} diary
 * @param {number} dayIndex
 * @returns {CopySource}
 */
export function copySource(diary, dayIndex) {
  const records = timedActivities(diary).filter((record) => record.dayIndex === dayIndex);
  if (!records.length) return { count: 0, firstStart: null, lastEnd: null };
  return {
    count: records.length,
    firstStart: Math.min(...records.map((record) => record.startMinutes)),
    lastEnd: Math.max(...records.map((record) => record.endMinutes)),
  };
}

/**
 * @param {import('./diary.js').ApiActivity} activity
 * @param {number} dayStartMinutes
 * @returns {CodedRecord}
 */
function codedRecord(activity, dayStartMinutes) {
  const record = toTimedActivity(activity, dayStartMinutes);
  return {
    id: activity.client_uuid,
    dayIndex: activity.day_label_index,
    startMinutes: record.startMinutes,
    endMinutes: record.endMinutes,
    activityCode: activity.activity_code,
  };
}

/**
 * Plan "copy this day onto those days".
 *
 * Every target is validated against the diary as it would look after the earlier
 * targets were accepted, so copying a night entry onto Saturday also counts for
 * Sunday when Sunday is a target too.
 *
 * @param {{
 *   diary: ApiDiary,
 *   sourceIndex: number,
 *   targetIndexes: number[],
 *   maxOverlap?: number,
 * }} input
 * @returns {CopyTarget[]}
 */
export function planCopy({ diary, sourceIndex, targetIndexes, maxOverlap = 2 }) {
  const dayStartMinutes = diary.study.day_start_minutes || 0;
  const dayCount = diary.days.length;
  const lastIndex = dayCount - 1;
  const counts = ownCounts(diary);

  /** @type {CodedRecord[]} */
  const existing = diary.activities.map((activity) => codedRecord(activity, dayStartMinutes));
  const sourceRecords = existing.filter((record) => record.dayIndex === sourceIndex);

  /** @type {CodedRecord[]} */
  let rows = existing;
  /** @type {CopyTarget[]} */
  const plan = [];

  const targets = [...new Set(targetIndexes)]
    .filter((dayIndex) => Number.isInteger(dayIndex) && dayIndex !== sourceIndex)
    .sort((a, b) => a - b);

  for (const dayIndex of targets) {
    if (dayIndex < 0 || dayIndex >= dayCount) {
      plan.push({ dayIndex, status: 'skipped', code: Codes.DAY_OUT_OF_RANGE, adds: 0, replaces: 0 });
      continue;
    }

    // The last day cannot hold a row that runs past the end of the diary.
    const night = sourceRecords.find((record) => record.endMinutes > MINUTES_PER_DAY);
    if (night && dayIndex === lastIndex) {
      plan.push({
        dayIndex,
        status: 'skipped',
        code: Codes.LAST_DAY_MIDNIGHT,
        meta: { dayIndex, startMinutes: night.startMinutes },
        adds: 0,
        replaces: counts.get(dayIndex) || 0,
      });
      continue;
    }

    const remaining = rows.filter((record) => record.dayIndex !== dayIndex);
    /** @type {CodedRecord[]} */
    const planned = [];
    let refusal = null;

    for (const source of sourceRecords) {
      const candidate = { ...source, dayIndex };
      const violation = overlapViolation({
        candidate,
        existing: [...remaining, ...planned],
        maxOverlap,
        step: STEP_MINUTES,
      });
      if (!violation.ok) {
        refusal = violation;
        break;
      }
      planned.push(candidate);
    }

    if (refusal) {
      plan.push({
        dayIndex,
        status: 'skipped',
        code: refusal.code,
        meta: refusal.meta,
        adds: 0,
        replaces: counts.get(dayIndex) || 0,
      });
      continue;
    }

    rows = [...remaining, ...planned];
    plan.push({
      dayIndex,
      status: 'copied',
      adds: planned.length,
      replaces: counts.get(dayIndex) || 0,
    });
  }

  return plan;
}

/**
 * The targets that will be overwritten, in plan order. Empty days are left out:
 * the question the hint line answers is "what do I lose?".
 *
 * @param {CopyTarget[]} plan
 * @returns {CopyTarget[]}
 */
export function overwrites(plan) {
  return plan.filter((target) => target.status === 'copied' && target.replaces > 0);
}

/**
 * The targets the rules refuse, in plan order.
 *
 * @param {CopyTarget[]} plan
 * @returns {CopyTarget[]}
 */
export function refusals(plan) {
  return plan.filter((target) => target.status === 'skipped');
}
