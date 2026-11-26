// @ts-check
/**
 * The study's time grid, read once per use from the diary payload.
 *
 * Two settings, for two different questions:
 *
 * - `step` — how precisely a time can be typed (and clicked). It is what the
 *   native time picker offers, so it has to match what participants enter: at a
 *   10-minute step, typing 06:15 becomes 06:10 and looks like a misclick.
 * - `minDuration` — the shortest activity. This is what keeps blocks large
 *   enough to see and tap when the step is fine. With step 5 and minimum 10 the
 *   smallest block is the same 10-minute block that exists today.
 *
 * `defaultDuration` is the length of a new entry before the day's free time
 * shortens it: an hour, rounded up to whole steps and never below the minimum.
 *
 * The backend only stores minutes; these rules are the client's. The server
 * validates the *configuration* (step in this list, minimum a multiple of the
 * step), and refuses neither, so a missing or odd value here degrades to the
 * historical 10/10 instead of breaking a diary.
 */

import { MAX_DURATION_MINUTES, STEP_MINUTES } from './time.js';

/**
 * Allowed steps: multiples of five that divide the day. The divisor rule is
 * what keeps midnight on the grid - with a 25-minute step a 23:20-24:00 entry
 * would end off-grid and could never be saved.
 */
export const ALLOWED_TIME_STEPS = [5, 10, 15, 20, 30, 60];

/** What a new entry lasts, before the free time around it shortens it. */
export const DEFAULT_DURATION_MINUTES = 60;

/**
 * @param {unknown} value
 * @param {number} fallback
 * @param {number} max
 * @returns {number}
 */
function positiveOr(value, fallback, max) {
  return typeof value === 'number' && Number.isFinite(value) && value > 0
    ? Math.min(value, max)
    : fallback;
}

/**
 * @param {{ study?: { time_step_minutes?: number, min_duration_minutes?: number } } | null | undefined} diary
 * @returns {{ step: number, minDuration: number, defaultDuration: number }}
 */
export function timingFor(diary) {
  const study = diary?.study || {};
  const rawStep = positiveOr(study.time_step_minutes, STEP_MINUTES, MAX_DURATION_MINUTES);
  // Configuration is validated on import; a row that still holds something else
  // (or a step that would put midnight off the grid) falls back to 10.
  const step = ALLOWED_TIME_STEPS.includes(rawStep) ? rawStep : STEP_MINUTES;
  const rawMin = positiveOr(study.min_duration_minutes, step, MAX_DURATION_MINUTES);
  // Defensive: stored configuration is validated, but a minimum that is not a
  // whole number of steps would make the form reject the range it just built.
  const minDuration = Math.min(
    MAX_DURATION_MINUTES,
    Math.max(step, Math.ceil(rawMin / step) * step)
  );
  const defaultDuration = Math.max(
    minDuration,
    Math.ceil(DEFAULT_DURATION_MINUTES / step) * step
  );
  return { step, minDuration, defaultDuration };
}
