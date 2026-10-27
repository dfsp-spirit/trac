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
 * How many day boundaries a day-relative minute has crossed (0 for a record
 * that ends on its own day, 1 for one that runs past midnight).
 *
 * @param {number} minutesSinceDayStart
 * @returns {number}
 */
export function dayOffset(minutesSinceDayStart) {
  return Math.floor(minutesSinceDayStart / MINUTES_PER_DAY);
}
