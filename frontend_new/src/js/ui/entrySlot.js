// @ts-check
/**
 * Where a new entry starts, and what the participant last said about it.
 *
 * Three ways into the form, one answer each:
 *
 * - they clicked a gap on the timeline - that exact range;
 * - they pressed add (or the keyboard shortcut) - "here", which
 *   `domain/suggestSlot.js` turns into a range that fits the day;
 * - they pressed "save and add another" - continue where the saved entry ended.
 *
 * The click is deliberately one-shot. A range that outlives the click it came
 * from used to pre-fill unrelated entries minutes later, which is what made the
 * old 08:00 default feel arbitrary.
 */
import { anchorAfterSave, suggestSlot } from '../domain/suggestSlot.js';

/**
 * @typedef {{ dayIndex: number, startMinutes: number, endMinutes: number }} Slot
 * @typedef {{
 *   id: string,
 *   dayIndex: number,
 *   startMinutes: number,
 *   endMinutes: number,
 * }} SlotRecord
 */

/**
 * @param {{
 *   getCurrentDay: () => number,
 *   getAnchorMinutes: (dayIndex: number) => number,
 * }} deps
 */
export function createEntrySlot({ getCurrentDay, getAnchorMinutes }) {
  /**
   * @type {{
   *   dayIndex: number,
   *   anchorMinutes?: number,
   *   startMinutes?: number,
   *   endMinutes?: number,
   * } | null}
   */
  let pending = null;

  return {
    /** @param {Slot} slot A gap the participant clicked: its exact range. */
    claim({ dayIndex, startMinutes, endMinutes }) {
      pending = { dayIndex, startMinutes, endMinutes };
    },

    /** @param {{ dayIndex: number, anchorMinutes: number }} next */
    anchor({ dayIndex, anchorMinutes }) {
      pending = { dayIndex, anchorMinutes };
    },

    /** @param {Slot} saved */
    continueAfter(saved) {
      pending = anchorAfterSave(saved);
    },

    /**
     * The range a new entry starts with; consumes whatever was pending.
     *
     * @param {SlotRecord[]} records The entries already on the diary.
     * @returns {Slot}
     */
    resolve(records) {
      const claimed = pending;
      pending = null;
      const dayIndex = claimed ? claimed.dayIndex : getCurrentDay();
      if (claimed && claimed.startMinutes != null && claimed.endMinutes != null) {
        return {
          dayIndex,
          startMinutes: claimed.startMinutes,
          endMinutes: claimed.endMinutes,
        };
      }
      const anchorMinutes = claimed?.anchorMinutes ?? getAnchorMinutes(dayIndex);
      return {
        dayIndex,
        ...suggestSlot({ anchorMinutes, dayIndex, records }),
      };
    },

    /** The day the next new entry would land on, for the context line. */
    get dayIndex() {
      return pending ? pending.dayIndex : getCurrentDay();
    },
  };
}
