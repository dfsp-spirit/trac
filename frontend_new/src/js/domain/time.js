// @ts-check
/**
 * Time units and clock formatting. The canonical definition of what a minute
 * means in this app, split from geometry so that the geometry module stays
 * about placement and both stay well under the size cap.
 *
 * Units. `startMinutes` and `endMinutes` are minutes since the start of the
 * study day (`Study.day_start_minutes`; 0 by default, so they are ordinary
 * clock minutes). A record may run past the end of its own day, up to 2880:
 * its tail is drawn on the following day (D5/D6). Keeping the data
 * day-relative is what lets the same functions serve a 00:00 and a legacy
 * 04:00 study without a special case.
 */

export const MINUTES_PER_DAY = 1440;
export const STEP_MINUTES = 10;
export const MAX_DURATION_MINUTES = MINUTES_PER_DAY;
/** How long a new entry is by default, before the day's free time shortens it. */
export const DEFAULT_DURATION_MINUTES = 60;

/** @param {number} minutes @param {number} min @param {number} max @returns {number} */
export function clampMinutes(minutes, min, max) {
  if (!Number.isFinite(minutes)) return min;
  return Math.min(Math.max(minutes, min), max);
}

/**
 * Snap to the configured step, clamped into [min, max].
 *
 * @param {number} minutes
 * @param {{ step?: number, min?: number, max?: number, mode?: 'round' | 'floor' | 'ceil' }} [options]
 * @returns {number}
 */
export function snapMinutes(minutes, options = {}) {
  const { step = STEP_MINUTES, min = 0, max = Number.POSITIVE_INFINITY, mode = 'round' } = options;
  if (!Number.isFinite(minutes)) return min;
  const scaled = minutes / step;
  const snapped =
    mode === 'floor' ? Math.floor(scaled) : mode === 'ceil' ? Math.ceil(scaled) : Math.round(scaled);
  return clampMinutes(snapped * step, min, max);
}

/**
 * Clock minutes -> minutes since the study day started (the inverse of
 * clockMinutes). Mirrors `coverage.to_day_relative` on the server.
 *
 * @param {number} minutes Clock minutes; may exceed 1440 for a next-day end.
 * @param {number} [dayStartMinutes]
 * @returns {number}
 */
export function toDayRelative(minutes, dayStartMinutes = 0) {
  let shifted = minutes - dayStartMinutes;
  if (shifted < 0) shifted += MINUTES_PER_DAY;
  return shifted;
}

/**
 * The wall-clock minute a day-relative minute maps to.
 *
 * @param {number} minutesSinceDayStart
 * @param {number} [dayStartMinutes] Study day start (0 = midnight).
 * @returns {number} 0..1439
 */
export function clockMinutes(minutesSinceDayStart, dayStartMinutes = 0) {
  const absolute = dayStartMinutes + minutesSinceDayStart;
  return ((absolute % MINUTES_PER_DAY) + MINUTES_PER_DAY) % MINUTES_PER_DAY;
}

/**
 * "07:30" for a day-relative minute. Display only: never parse this back.
 *
 * @param {number} minutesSinceDayStart
 * @param {number} [dayStartMinutes]
 * @returns {string}
 */
export function formatClock(minutesSinceDayStart, dayStartMinutes = 0) {
  const total = clockMinutes(minutesSinceDayStart, dayStartMinutes);
  const hours = Math.floor(total / 60);
  const minutes = total % 60;
  return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`;
}

/**
 * Parse the value of an `<input type="time">` ("HH:MM", 24-hour) into clock
 * minutes. Returns null while the field is incomplete: a segmented input
 * reports "" between edits, and a half-typed time must not be treated as 00:00.
 *
 * @param {string} value
 * @returns {number | null}
 */
export function parseClock(value) {
  const match = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(String(value ?? '').trim());
  return match ? Number(match[1]) * 60 + Number(match[2]) : null;
}

/**
 * The end that belongs to a wall-clock choice: the same day when it is later
 * than the start, the next one otherwise, clamped into what the day allows.
 *
 * A native time field only carries a time of day, so this is the one place that
 * decides which day the end belongs to. `isLastDay` mirrors the form: the last
 * day cannot run past midnight.
 *
 * @param {number} start Day-relative start minute.
 * @param {number} endClock Clock minutes (0..1439) from the end field.
 * @param {{ dayStartMinutes?: number, isLastDay?: boolean }} [options]
 * @returns {number} Day-relative end minute.
 */
export function resolveRangeEnd(start, endClock, options = {}) {
  const { dayStartMinutes = 0, isLastDay = false } = options;
  const max = isLastDay ? MINUTES_PER_DAY : start + MINUTES_PER_DAY;
  let candidate = toDayRelative(endClock, dayStartMinutes);
  // A clock that is not after the start belongs to the next day. Equality is the
  // one deliberate 24-hour entry (a whole day), which the duration line shows as
  // "24 h" - the alternative, silently shrinking it to the minimum, would ignore
  // what the participant typed.
  if (candidate <= start) candidate += MINUTES_PER_DAY;
  return clampMinutes(candidate, start + STEP_MINUTES, max);
}

/**
 * How many day boundaries a day-relative minute has crossed (0 for a record
 * that ends on its own day, 1 for one that runs past midnight).
 *
 * @param {number} minutesSinceDayStart
 * @returns {number}
 */
export function dayOffset(minutesSinceDayStart) {
  return Math.floor(minutesSinceDayStart / MINUTES_PER_DAY);
}
