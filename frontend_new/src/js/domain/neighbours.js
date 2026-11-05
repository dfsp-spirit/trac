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
  // that already touches its neighbour needs no chip.
  const snap =
    before && before.end < from && from - before.end <= SNAP_MAX_MINUTES
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
 * @param {Surroundings} found
 * @param {(key: string, values?: Record<string, string | number>) => string} t
 * @param {(absoluteMinute: number) => string} clock Absolute minute to "HH:MM".
 * @param {(name: string) => string} shortName Name as it may be shown.
 * @returns {string | null}
 */
export function neighbourText(found, t, clock, shortName) {
  if (found.overlaps.length) {
    const first = found.overlaps[0];
    const parts = [
      t('diary.form.neighbour.overlap', {
        name: shortName(first.name),
        range: `${clock(first.start)}–${clock(first.end)}`,
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
    parts.push(
      t('diary.form.neighbour.before', {
        name: shortName(found.before.name),
        time: clock(found.before.end),
      })
    );
  }
  if (found.after && found.after.name) {
    parts.push(
      t('diary.form.neighbour.after', {
        name: shortName(found.after.name),
        time: clock(found.after.start),
      })
    );
  }
  return parts.length ? parts.join(' · ') : null;
}
