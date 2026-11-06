// @ts-check
/**
 * Where the form should start when the participant has not pointed at a time.
 *
 * One sentence, used by every way into the form (the panel's catalogue list, the
 * "add" button, the keyboard shortcut and "save and add another"): *start where
 * the participant is looking, in the next free minute of that day, and stop
 * after {@link DEFAULT_DURATION_MINUTES} or at the next entry, whichever comes
 * first.*
 *
 * The anchor is the only input that differs between those paths, and it is
 * always something the participant can see: the top of the visible timeline, or
 * the end of the entry they just saved while the form covered the timeline.
 * Nothing here looks at history - what was added last says nothing about the
 * time being filled in (see `domain/neighbours.js` for the same rule).
 *
 * A default must never silently overlap another entry: an hour that does not fit
 * is shortened to the free block, and a block too short for a new entry is
 * skipped. Only a day without any free minute left falls back to a short slot
 * at the anchor, which the form's neighbour hint then explains.
 *
 * Minutes are day-relative, the axis of the timeline and of the form's time
 * selects (0 is the start of the study day, 1440 its end).
 */
import {
  DEFAULT_DURATION_MINUTES,
  MINUTES_PER_DAY,
  STEP_MINUTES,
  snapMinutes,
} from './time.js';
import { absoluteEnd, absoluteStart } from './validation.js';

/** A slot shorter than one step cannot be saved, so it is not offered. */
export const MIN_SLOT_MINUTES = STEP_MINUTES;

/**
 * @typedef {{ dayIndex: number, startMinutes: number, endMinutes: number }} SlotRecord
 * @typedef {{ startMinutes: number, endMinutes: number }} Slot
 */

/**
 * The suggested start and end for a new entry on one day.
 *
 * @param {{
 *   anchorMinutes: number,
 *   dayIndex?: number,
 *   records?: SlotRecord[],
 *   durationMinutes?: number,
 *   step?: number,
 * }} input `anchorMinutes` is where the participant is looking, on the same
 *   day-relative axis. `records` are the entries already on the diary.
 * @returns {Slot}
 */
export function suggestSlot({
  anchorMinutes,
  dayIndex = 0,
  records = [],
  durationMinutes = DEFAULT_DURATION_MINUTES,
  step = STEP_MINUTES,
}) {
  const busy = busyIntervals(records, dayIndex);
  const anchor = snapMinutes(anchorMinutes, {
    step,
    min: 0,
    // The last start of the day, so a late anchor still has room for one step.
    max: MINUTES_PER_DAY - MIN_SLOT_MINUTES,
    mode: 'ceil',
  });

  for (let start = anchor; start + MIN_SLOT_MINUTES <= MINUTES_PER_DAY; start += step) {
    const slotEnd = start + MIN_SLOT_MINUTES;
    // A record can begin inside the step (an anchor dragged off the grid), so
    // test the whole slot, not just its first minute.
    const blocked = busy.some(
      (interval) => interval.start < slotEnd && interval.end > start
    );
    if (blocked) continue;

    const next = busy.find((interval) => interval.start > start);
    const freeEnd = next ? next.start : MINUTES_PER_DAY;
    return {
      startMinutes: start,
      endMinutes: Math.min(start + durationMinutes, freeEnd),
    };
  }

  // The day is full. Offering nothing would strand the participant, so keep the
  // anchor and let the form say what saving would overlap.
  const fallback = Math.min(anchor, MINUTES_PER_DAY - MIN_SLOT_MINUTES);
  return { startMinutes: fallback, endMinutes: fallback + MIN_SLOT_MINUTES };
}

/**
 * Where the next entry should start after one was saved into a free block.
 *
 * Used by "save and add another", where the form covers the timeline and the end
 * of what was just saved is the only place the participant can be looking at.
 *
 * @param {{ dayIndex: number, startMinutes: number, endMinutes: number }} saved
 * @returns {{ dayIndex: number, anchorMinutes: number }} The same day, or the
 *   next one when the entry ran past the end of its day.
 */
export function anchorAfterSave(saved) {
  const dayOffset = Math.floor(saved.endMinutes / MINUTES_PER_DAY);
  return {
    dayIndex: saved.dayIndex + dayOffset,
    anchorMinutes: saved.endMinutes % MINUTES_PER_DAY,
  };
}

/**
 * The entries of one day as local, clipped intervals.
 *
 * A record that runs past midnight contributes only the part that falls into
 * `dayIndex`, so a cross-midnight night is one block on each day.
 *
 * @param {SlotRecord[]} records
 * @param {number} dayIndex
 * @returns {Array<{ start: number, end: number }>}
 */
function busyIntervals(records, dayIndex) {
  const dayOffsetMinutes = dayIndex * MINUTES_PER_DAY;
  /** @type {Array<{ start: number, end: number }>} */
  const intervals = [];

  for (const record of records || []) {
    if (!record) continue;
    const start = absoluteStart(record) - dayOffsetMinutes;
    const end = absoluteEnd(record) - dayOffsetMinutes;
    if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) continue;
    if (end <= 0 || start >= MINUTES_PER_DAY) continue;
    intervals.push({
      start: Math.max(0, start),
      end: Math.min(MINUTES_PER_DAY, end),
    });
  }

  return intervals.sort((a, b) => a.start - b.start);
}
