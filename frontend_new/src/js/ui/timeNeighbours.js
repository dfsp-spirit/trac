// @ts-check
/**
 * The boundary hint under the activity form's time row.
 *
 * It exists because the phone form covers the timeline: without it, the only way
 * to learn where the previous entry ended is to leave the form and look. Desktop
 * gets the same line - it costs one short line and removes the same guesswork
 * there.
 *
 * The widget reads the form's own controls through `getSelection`, so the hint
 * follows the day/start/end the participant actually chose, and it says nothing
 * when the day around the range is empty.
 */
import { MINUTES_PER_DAY, formatClock, toDayRelative } from '../domain/time.js';
import { neighbourText, surrounding } from '../domain/neighbours.js';

/** Longer names are cut in the hint; the form still shows the full name. */
const MAX_NAME_CHARS = 28;

/**
 * @template {keyof HTMLElementTagNameMap} K
 * @param {K} tag
 * @param {string | null} [className]
 * @param {string | null} [text]
 * @returns {HTMLElementTagNameMap[K]}
 */
function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text != null) node.textContent = text;
  return node;
}

/**
 * @param {string} name
 * @returns {string}
 */
function shortName(name) {
  const text = String(name || '');
  return text.length > MAX_NAME_CHARS
    ? `${text.slice(0, MAX_NAME_CHARS - 1)}…`
    : text;
}

/**
 * @param {{
 *   t: (key: string, values?: Record<string, string | number>) => string,
 *   dayStartMinutes: number,
 *   existing: import('../domain/neighbours.js').NeighbourRecord[],
 *   days: Array<{ index: number, name: string, display_name?: string, display_names?: Record<string, string> }>,
 *   language: string,
 *   getSelection: () => { dayIndex: number, start: number, end: number },
 *   getCurrentId: () => string | null,
 *   onSnap: (startValue: number) => void,
 * }} deps
 */
export function createTimeNeighbours({
  t,
  dayStartMinutes,
  existing,
  days = [],
  language = '',
  getSelection,
  getCurrentId,
  onSnap,
}) {
  const element = el('div', 't-neighbours');
  element.hidden = true;

  const line = el('p', 't-hint');
  // Polite, not assertive: the participant is editing, not being interrupted.
  line.setAttribute('role', 'status');

  const snap = el('button', 't-btn t-btn--secondary t-btn--sm');
  snap.type = 'button';
  snap.hidden = true;

  element.append(line, snap);

  /** @type {{ name: string, at: number } | null} */
  let pending = null;

  snap.addEventListener('click', () => {
    if (!pending) return;
    const { dayIndex } = getSelection();
    // Back from the absolute axis to the coordinate the time selects use.
    onSnap(pending.at - dayIndex * MINUTES_PER_DAY);
  });

  /** @param {number} absoluteMinute */
  const clock = (absoluteMinute) =>
    formatClock(absoluteMinute % MINUTES_PER_DAY, dayStartMinutes);

  /**
   * A neighbour's time, plus its weekday when it is not on the day being
   * edited: on a week filled with the same routine, the entry after a morning
   * one is tomorrow's, and a bare "ab 00:00" reads as today.
   *
   * @param {number} absoluteMinute
   * @param {number} dayIndex The day the form is editing.
   * @returns {import('../domain/neighbours.js').ClockText}
   */
  function describe(absoluteMinute, dayIndex) {
    const time = clock(absoluteMinute);
    const onDay = Math.floor(absoluteMinute / MINUTES_PER_DAY);
    if (onDay === dayIndex) return { time, day: null };
    const day = days.find((item) => item.index === onDay);
    if (!day) return { time, day: null };
    return {
      time,
      day:
        (day.display_names && day.display_names[language]) ||
        day.display_name ||
        day.name,
    };
  }

  return {
    element,

    /**
     * Recompute after the day, start or end changed.
     */
    refresh() {
      const selection = getSelection();
      const start = toDayRelative(selection.start, dayStartMinutes);
      let end = toDayRelative(selection.end, dayStartMinutes);
      if (end <= start) end += MINUTES_PER_DAY;

      const currentId = getCurrentId();
      const found = surrounding({
        candidate: {
          id: currentId || 'new',
          dayIndex: selection.dayIndex,
          startMinutes: start,
          endMinutes: end,
        },
        existing,
        ignoreId: currentId,
      });

      const text = neighbourText(
        found,
        t,
        (minute) => describe(minute, selection.dayIndex),
        shortName
      );
      line.textContent = text || '';

      pending = found.snap;
      snap.hidden = !found.snap;
      if (found.snap) {
        snap.textContent = t('diary.form.neighbour.snap', {
          name: shortName(found.snap.name),
          time: clock(found.snap.at),
        });
      }

      element.hidden = !text && !found.snap;
    },
  };
}
