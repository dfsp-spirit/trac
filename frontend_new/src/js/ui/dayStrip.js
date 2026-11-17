// @ts-check
/**
 * The compact day strip: one row of pixels per lane of a day, light grey where
 * nothing is recorded and the study's own activity colour where something is.
 *
 * Written for the add-activity form - "where would this land, and what is
 * already there?" - but deliberately not tied to it. It takes records and a day
 * index and knows nothing about forms, so the day rail and the review page can
 * mount the same picture later by handing it their own activities.
 *
 * Resolution is the whole point. The form offers 288 px to a whole day on the
 * narrowest phone, so one 10-minute step is 2 px: segments are positioned as
 * percentages of the day rather than as 144 cells, which keeps a boundary exact
 * at any width and costs one node per activity instead of 144.
 *
 * Row count is dynamic: a day with two activities running in parallel gets two
 * rows, a day without gets one. `layoutDay` already packs the lanes the same way
 * the timeline does, so the strip and the diary never disagree about overlaps.
 */
import { isColour } from '../domain/color.js';
import { layoutDay } from '../domain/geometry.js';
import { MINUTES_PER_DAY } from '../domain/time.js';
import { el } from './dom.js';

/**
 * @typedef {import('../domain/geometry.js').TimedRecord & { color?: string | null }} StripRecord
 */

/**
 * @param {{
 *   records: StripRecord[],
 *   dayIndex: number,
 *   pending?: { start: number, end: number } | null,
 *   maxRows?: number,
 * }} input `pending` is the range the participant is configuring right now. It
 *   gets a row of its own: at 2 px per 10 minutes an outline around the range
 *   would be wider than the range itself, and reusing an activity colour for it
 *   would claim a colour the study never defined.
 * @returns {HTMLElement}
 */
export function buildDayStrip({ records, dayIndex, pending = null, maxRows = Infinity }) {
  const { segments } = layoutDay(records || [], dayIndex);
  const lanes = segments.reduce((most, segment) => Math.max(most, segment.laneCount), 1);
  const rowCount = Math.max(1, Math.min(lanes, maxRows));

  const root = el('div', 't-daystrip');
  // A glance, not a source: every fact here is also on the page in words (the
  // surrounding entries, the duration line), and colour alone may not be the
  // only carrier of information (WCAG 1.4.1). So it stays out of the
  // accessibility tree and out of the tab order.
  root.setAttribute('aria-hidden', 'true');

  /** @type {HTMLElement[]} */
  const rows = [];
  for (let lane = 0; lane < rowCount; lane += 1) {
    const row = el('div', 't-daystrip__row');
    rows.push(row);
    root.append(row);
  }

  for (const segment of segments) {
    const row = rows[Math.min(segment.lane, rowCount - 1)];
    // Geometry carries the record through untouched; only the colour is ours.
    const record = /** @type {StripRecord} */ (segment.record);
    row.append(segmentNode(segment.start, segment.end, record.color));
  }

  const pendingStart = clampToDay(pending?.start);
  const pendingEnd = clampToDay(pending?.end);
  if (pendingStart !== null && pendingEnd !== null && pendingEnd > pendingStart) {
    const row = el('div', 't-daystrip__row t-daystrip__row--pending');
    row.append(segmentNode(pendingStart, pendingEnd, null, 't-daystrip__seg--pending'));
    root.append(row);
  }

  return root;
}

/**
 * Minutes clipped to the day. An entry that runs past midnight belongs to the
 * next day's strip, exactly as the timeline splits it.
 *
 * @param {number | undefined} minutes
 * @returns {number | null} null when the value is not a usable minute
 */
function clampToDay(minutes) {
  if (typeof minutes !== 'number' || !Number.isFinite(minutes)) return null;
  return Math.max(0, Math.min(MINUTES_PER_DAY, minutes));
}

/**
 * One coloured bar, positioned as a share of the day.
 *
 * @param {number} start
 * @param {number} end
 * @param {string | null | undefined} colour
 * @param {string} [modifier]
 * @returns {HTMLElement}
 */
function segmentNode(start, end, colour, modifier = '') {
  const node = el('span', `t-daystrip__seg${modifier ? ` ${modifier}` : ''}`);
  node.style.left = `${(start / MINUTES_PER_DAY) * 100}%`;
  node.style.width = `${((end - start) / MINUTES_PER_DAY) * 100}%`;
  // A study colour the browser cannot parse would leave the row looking like
  // "nothing recorded", so it falls back to the neutral bar instead.
  if (isColour(colour)) node.style.background = String(colour);
  return node;
}
