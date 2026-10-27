// @ts-check
/**
 * Pure activity rules: time ranges, the overlap limit, duplicates and
 * multi-day creation (D8, D19, D21). No HTTP, no DOM, no i18n.
 *
 * Each check returns a stable machine code from `Codes`; the UI maps codes to
 * `diary.*` messages. Codes never change with wording, and no user-facing text
 * is produced here.
 */
import { MAX_DURATION_MINUTES, MINUTES_PER_DAY, STEP_MINUTES } from './time.js';

export const Codes = Object.freeze({
  END_NOT_AFTER_START: 'time.end_not_after_start',
  START_OUT_OF_RANGE: 'time.start_out_of_range',
  TOO_LONG: 'time.too_long',
  NOT_ON_STEP: 'time.not_on_step',
  OVERLAP_LIMIT: 'overlap.limit_reached',
  DUPLICATE: 'activity.duplicate',
  DAY_OUT_OF_RANGE: 'day.out_of_range',
  LAST_DAY_MIDNIGHT: 'day.ends_at_midnight',
});

/** Default from the PI answer to Q1; the value is a study setting. */
export const DEFAULT_MAX_OVERLAP = 2;

/**
 * @typedef {import('./geometry.js').TimedRecord} TimedRecord
 * @typedef {{ id: string, dayIndex: number, startMinutes: number, endMinutes: number, activityCode: string | number }} CodedRecord
 * @typedef {{ ok: true } | { ok: false, code: string, meta?: Record<string, unknown> }} Result
 */

/**
 * @param {string | number} value
 * @returns {string}
 */
function codeKey(value) {
  return String(value);
}

/**
 * Absolute minute on a study-wide axis, so a record that runs past midnight
 * compares correctly with one on the next day.
 *
 * @param {{ dayIndex: number, startMinutes: number }} record
 * @returns {number}
 */
export function absoluteStart(record) {
  return record.dayIndex * MINUTES_PER_DAY + record.startMinutes;
}

/**
 * @param {{ dayIndex: number, endMinutes: number }} record
 * @returns {number}
 */
export function absoluteEnd(record) {
  return record.dayIndex * MINUTES_PER_DAY + record.endMinutes;
}

/**
 * @param {{ startMinutes: number, endMinutes: number }} range
 * @param {{ step?: number }} [options]
 * @returns {Result}
 */
export function validateTimeRange(range, options = {}) {
  const { step = STEP_MINUTES } = options;
  const { startMinutes, endMinutes } = range;

  if (!Number.isFinite(startMinutes) || !Number.isFinite(endMinutes)) {
    return { ok: false, code: Codes.END_NOT_AFTER_START };
  }
  if (startMinutes < 0 || startMinutes >= MINUTES_PER_DAY) {
    return { ok: false, code: Codes.START_OUT_OF_RANGE, meta: { startMinutes } };
  }
  if (endMinutes <= startMinutes) {
    return { ok: false, code: Codes.END_NOT_AFTER_START, meta: { startMinutes, endMinutes } };
  }
  if (endMinutes - startMinutes > MAX_DURATION_MINUTES) {
    return { ok: false, code: Codes.TOO_LONG, meta: { durationMinutes: endMinutes - startMinutes } };
  }
  if (startMinutes % step !== 0 || endMinutes % step !== 0) {
    return { ok: false, code: Codes.NOT_ON_STEP, meta: { step } };
  }
  return { ok: true };
}

/**
 * The first minute where adding `candidate` would put more than `maxOverlap`
 * activities at the same time. Overlap is measured across days, so the tail of
 * a cross-midnight activity counts on the following day.
 *
 * @param {{
 *   candidate: CodedRecord,
 *   existing: CodedRecord[],
 *   maxOverlap?: number,
 *   ignoreId?: string | null,
 *   step?: number,
 * }} input
 * @returns {Result}
 */
export function overlapViolation(input) {
  const {
    candidate,
    existing,
    maxOverlap = DEFAULT_MAX_OVERLAP,
    ignoreId = null,
    step = STEP_MINUTES,
  } = input;

  const from = absoluteStart(candidate);
  const to = absoluteEnd(candidate);
  if (to <= from) return { ok: true };

  const others = existing
    .filter((record) => record && record.id !== candidate.id && record.id !== ignoreId)
    .map((record) => ({ start: absoluteStart(record), end: absoluteEnd(record) }))
    .filter((interval) => interval.end > from && interval.start < to);

  for (let minute = from; minute < to; minute += step) {
    const probe = minute + step / 2;
    let count = 1; // the candidate itself
    for (const interval of others) {
      if (interval.start <= probe && probe < interval.end) count += 1;
    }
    if (count > maxOverlap) {
      // Name the day and minute of the *conflict*, not of the candidate: a night
      // activity spills into the next day, and "Tuesday 01:00 is full" is what
      // the participant can act on.
      return {
        ok: false,
        code: Codes.OVERLAP_LIMIT,
        meta: {
          dayIndex: Math.floor(minute / MINUTES_PER_DAY),
          minutesSinceDayStart: minute % MINUTES_PER_DAY,
          count,
          maxOverlap,
        },
      };
    }
  }
  return { ok: true };
}

/**
 * Same activity, same day, same times: a duplicate of a row that already
 * exists (D8). The server enforces this too; catching it here keeps a
 * round-trip and an error out of the participant's way.
 *
 * @param {{ candidate: CodedRecord, existing: CodedRecord[], ignoreId?: string | null }} input
 * @returns {boolean}
 */
export function isDuplicate(input) {
  const { candidate, existing, ignoreId = null } = input;
  const key = codeKey(candidate.activityCode);
  return existing.some(
    (record) =>
      record &&
      record.id !== candidate.id &&
      record.id !== ignoreId &&
      record.dayIndex === candidate.dayIndex &&
      record.startMinutes === candidate.startMinutes &&
      record.endMinutes === candidate.endMinutes &&
      codeKey(record.activityCode) === key
  );
}

/**
 * All rules that apply to adding or moving one activity.
 *
 * @param {{
 *   candidate: CodedRecord,
 *   existing: CodedRecord[],
 *   dayCount: number,
 *   maxOverlap?: number,
 *   ignoreId?: string | null,
 *   step?: number,
 * }} input
 * @returns {Result}
 */
export function validateActivity(input) {
  const { candidate, existing, dayCount, maxOverlap = DEFAULT_MAX_OVERLAP, ignoreId = null, step } = input;

  const range = validateTimeRange(candidate, { step });
  if (!range.ok) return range;

  if (!Number.isInteger(candidate.dayIndex) || candidate.dayIndex < 0 || candidate.dayIndex >= dayCount) {
    return { ok: false, code: Codes.DAY_OUT_OF_RANGE, meta: { dayIndex: candidate.dayIndex, dayCount } };
  }
  if (candidate.endMinutes > MINUTES_PER_DAY && candidate.dayIndex === dayCount - 1) {
    return { ok: false, code: Codes.LAST_DAY_MIDNIGHT, meta: { dayIndex: candidate.dayIndex } };
  }
  if (isDuplicate({ candidate, existing, ignoreId })) {
    return { ok: false, code: Codes.DUPLICATE };
  }
  return overlapViolation({ candidate, existing, maxOverlap, ignoreId, step });
}

/**
 * @typedef {Object} MultiDayTarget
 * @property {number} dayIndex
 * @property {'added' | 'skipped'} status
 * @property {string} [code] Why a target was skipped, from Codes.
 */

/**
 * Plan "this activity also happened on those days" (D19).
 *
 * Every target is validated against the records that would exist by then, so a
 * cross-midnight activity accepted for Monday is taken into account when
 * Tuesday is evaluated. The caller turns every `added` target into one record
 * in one request with a shared group id.
 *
 * The source day (`candidate.dayIndex`) is always included; duplicates in
 * `targets` are ignored.
 *
 * @param {{
 *   candidate: CodedRecord,
 *   targets: number[],
 *   dayCount: number,
 *   existing: CodedRecord[],
 *   maxOverlap?: number,
 *   ignoreId?: string | null,
 *   step?: number,
 * }} input
 * @returns {MultiDayTarget[]}
 */
export function planMultiDayCreate(input) {
  const { candidate, targets, dayCount, existing, maxOverlap = DEFAULT_MAX_OVERLAP, ignoreId = null, step } = input;

  const unique = [...new Set([candidate.dayIndex, ...targets])]
    .filter((dayIndex) => Number.isInteger(dayIndex))
    .sort((a, b) => a - b);

  /** @type {CodedRecord[]} */
  const planned = [];
  /** @type {MultiDayTarget[]} */
  const results = [];

  for (const dayIndex of unique) {
    const target = { ...candidate, dayIndex };
    const result = validateActivity({
      candidate: target,
      existing: [...existing, ...planned],
      dayCount,
      maxOverlap,
      ignoreId,
      step,
    });
    if (result.ok) {
      planned.push(target);
      results.push({ dayIndex, status: 'added' });
    } else {
      results.push({ dayIndex, status: 'skipped', code: result.code });
    }
  }
  return results;
}
