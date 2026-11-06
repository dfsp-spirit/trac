// @ts-check
/**
 * What sits immediately before and after the range the participant is choosing.
 *
 * On a phone the activity form covers the timeline, so the one fact a
 * participant cannot look up is where the neighbouring entry ends: "did I sleep
 * until 6:00 or 6:10?". This module answers exactly that, from the same records
 * the validation uses (`activityForm.js` builds them once for `validateActivity`
 * and for this hint, so the hint and the rule cannot disagree).
 *
 * It deliberately reports *boundaries*, not history: what was added last says
 * nothing about the time being edited.
 *
 * Cross-midnight works on the same absolute axis as validation, so a night
 * activity is a neighbour of the next morning.
 */
import { MINUTES_PER_DAY } from './time.js';
import { absoluteEnd, absoluteStart } from './validation.js';

/**
 * How close a neighbour's edge must be before "continue it" is offered. Beyond
 * this it is not a forgotten boundary but a different free block, and snapping
 * would silently move the entry somewhere the participant did not point at.
 */
export const SNAP_MAX_MINUTES = 60;

/**
 * @typedef {{
 *   id: string,
 *   dayIndex: number,
 *   startMinutes: number,
 *   endMinutes: number,
 *   name?: string,
 * }} NeighbourRecord
 */

/**
 * @typedef {{ name: string, start: number, end: number, minutes: number }} Overlap
 */

/**
 * @typedef {{ time: string, day: string | null }} ClockText A neighbour's clock
 *   time, with its weekday when it is not on the day being edited.
 */

/**
 * @typedef {{
 *   overlaps: Overlap[],
 *   before: { name: string, end: number } | null,
 *   after: { name: string, start: number } | null,
 *   snap: { name: string, at: number } | null,
 * }} Surroundings
 */

/**
 * @param {{
 *   candidate: NeighbourRecord,
 *   existing: NeighbourRecord[],
 *   ignoreId?: string | null,
 * }} input
 * @returns {Surroundings}
 */
export function surrounding({ candidate, existing, ignoreId = null }) {
  const from = absoluteStart(candidate);
  const to = absoluteEnd(candidate);

  const others = (existing || [])
    .filter(
      (record) =>
        record && record.id !== candidate.id && record.id !== ignoreId
    )
    .map((record) => ({
      name: record.name || '',
      start: absoluteStart(record),
      end: absoluteEnd(record),
    }));

  // The reported range is the *overlap*, not the whole neighbour: "10 minutes
  // where this sits on top of Sleeping (06:00-06:10)" is the actionable fact.
  const overlaps = others
    .filter((other) => other.end > from && other.start < to)
    .map((other) => {
      const start = Math.max(from, other.start);
      const end = Math.min(to, other.end);
      return { name: other.name, start, end, minutes: end - start };
    })
    .sort((left, right) => left.start - right.start);

  // Nearest edge on each side of the range. Sorting is clearer than a reduce
  // here, and the lists are a diary day, not a database.
  const before =
    others
      .filter((other) => other.end <= from)
      .sort((left, right) => right.end - left.end)[0] || null;
  const after =
    others
      .filter((other) => other.start >= to)
      .sort((left, right) => left.start - right.start)[0] || null;

  // Only slightly-missed boundaries are worth a one-tap correction. An entry
  // that already touches its neighbour needs no chip, and neither does a
  // boundary on another day: the form's start select only spans the day being
  // edited, so the chip could not move the entry there.
  const beforeIsOnThisDay =
    before !== null && Math.floor(before.end / MINUTES_PER_DAY) === candidate.dayIndex;
  const snap =
    before &&
    beforeIsOnThisDay &&
    before.end < from &&
    from - before.end <= SNAP_MAX_MINUTES
      ? { name: before.name, at: before.end }
      : null;

  return {
    overlaps,
    before: before ? { name: before.name, end: before.end } : null,
    after: after ? { name: after.name, start: after.start } : null,
    snap,
  };
}

/**
 * The boundary hint as one line, or `null` when the day is empty around the
 * range (nothing to say, and an empty line would only cost space).
 *
 * Overlap wins over the boundaries: it is the fact that costs data quality, and
 * a tolerated overlap (`max_overlap`) would otherwise pass without a word.
 *
 * A neighbour may sit on another day - a routine filled on all seven days puts
 * the same activity on both sides of every entry. Its time alone would then read
 * as "today", so `describe` names the weekday and the sentence uses the `…Day`
 * variant: "Schlafen bis 09:00 · Schlafen ab 00:00 (Dienstag)".
 *
 * @param {Surroundings} found
 * @param {(key: string, values?: Record<string, string | number>) => string} t
 * @param {(absoluteMinute: number) => ClockText} describe Absolute minute to
 *   its clock time, plus the weekday when it is not the day being edited.
 * @param {(name: string) => string} shortName Name as it may be shown.
 * @returns {string | null}
 */
export function neighbourText(found, t, describe, shortName) {
  if (found.overlaps.length) {
    const first = found.overlaps[0];
    const start = describe(first.start);
    const end = describe(first.end);
    // One marker on the range is enough; it is the end that tends to leave the
    // day, because a candidate may run past midnight.
    const day = end.day || start.day;
    const parts = [
      t('diary.form.neighbour.overlap', {
        name: shortName(first.name),
        range: `${start.time}–${end.time}${day ? ` (${day})` : ''}`,
        minutes: first.minutes,
      }),
    ];
    if (found.overlaps.length > 1) {
      parts.push(
        t('diary.form.neighbour.overlapMore', {
          count: found.overlaps.length - 1,
        })
      );
    }
    return parts.join(' · ');
  }

  const parts = [];
  if (found.before && found.before.name) {
    const at = describe(found.before.end);
    const key = at.day
      ? 'diary.form.neighbour.beforeDay'
      : 'diary.form.neighbour.before';
    parts.push(t(key, boundaryValues(found.before.name, at, shortName)));
  }
  if (found.after && found.after.name) {
    const at = describe(found.after.start);
    const key = at.day
      ? 'diary.form.neighbour.afterDay'
      : 'diary.form.neighbour.after';
    parts.push(t(key, boundaryValues(found.after.name, at, shortName)));
  }
  return parts.length ? parts.join(' · ') : null;
}

/**
 * Translator values for one side of the range. The weekday is only passed when
 * there is one, so the same-day phrases keep their original values.
 *
 * @param {string} name
 * @param {ClockText} at
 * @param {(name: string) => string} shortName
 * @returns {Record<string, string | number>}
 */
function boundaryValues(name, at, shortName) {
  /** @type {Record<string, string | number>} */
  const values = { name: shortName(name), time: at.time };
  if (at.day) values.day = at.day;
  return values;
}
