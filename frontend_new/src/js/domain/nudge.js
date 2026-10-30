// @ts-check
/**
 * Arrow-key nudging of one activity (D31): the keyboard equivalent of moving a
 * block by hand, and the quick-adjust path that works on every input method.
 *
 * Pure, and in the same day-relative minutes as every other range in the
 * domain, so the caller can hand the result straight to `validateActivity`.
 *
 *  * **move** shifts both edges (the block keeps its duration),
 *  * **resize** shifts only the end, which is what `Shift` turns a move into.
 */
import { MINUTES_PER_DAY, STEP_MINUTES } from './time.js';

/** @typedef {{ startMinutes: number, endMinutes: number }} Range */

/**
 * @param {Range} range
 * @param {{ mode: 'move' | 'resize', delta: number }} change Signed delta in minutes.
 * @returns {Range | null} The nudged range, or null when the edge of the day or
 *   the minimum duration leaves no room in that direction.
 */
export function nudgeRange({ startMinutes, endMinutes }, { mode, delta }) {
  if (mode === 'resize') {
    const end = endMinutes + delta;
    // A record is always at least one step long. Shrinking past that does
    // nothing instead of snapping to a length nobody asked for.
    if (end - startMinutes < STEP_MINUTES) return null;
    return { startMinutes, endMinutes: end };
  }

  const start = startMinutes + delta;
  // A record belongs to the day it starts on (D6), so a move stops at both ends
  // of its own day. Its end may still reach past midnight (D5), exactly as it
  // can through the form; `validateActivity` refuses that on the last day.
  if (start < 0 || start >= MINUTES_PER_DAY) return null;
  return { startMinutes: start, endMinutes: endMinutes + delta };
}
