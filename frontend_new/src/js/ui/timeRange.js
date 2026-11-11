// @ts-check
/**
 * The start/end fields of the activity form.
 *
 * One native time field per bound: a segmented, typeable field on desktop and
 * the OS picker (dial on Android, wheel on iOS) on phones. A time of day alone
 * cannot say which day it belongs to, so the end is resolved against the start -
 * the same day when it is later, the next one otherwise - and against the day's
 * limits. The resolved day is shown as a "(next day)" note, the only thing a
 * native time field cannot express.
 *
 * Keeping this apart from the rest of the form is also what keeps the form
 * inside the component-size budget.
 */
import {
  DEFAULT_DURATION_MINUTES,
  MINUTES_PER_DAY,
  STEP_MINUTES,
  formatClock,
  parseClock,
  resolveRangeEnd,
  snapMinutes,
  toDayRelative,
} from '../domain/time.js';
import { el } from './dom.js';
import { durationText, field, timeInput } from './formFields.js';

/**
 * @param {{
 *   t: (key: string, params?: Record<string, string | number>) => string,
 *   dayStartMinutes: number,
 *   lastIndex: number,
 *   dayIndex: number,
 *   startMinutes: number,
 *   endMinutes: number,
 *   onCommit: () => void,
 * }} deps `onCommit` runs after every committed start/end/day change, so the
 *   form can refresh what is derived from the selection (chips, hints).
 */
export function createTimeRange({
  t,
  dayStartMinutes,
  lastIndex,
  dayIndex,
  startMinutes,
  endMinutes,
  onCommit,
}) {
  const startInput = timeInput();
  startInput.value = formatClock(startMinutes, dayStartMinutes);

  const endInput = timeInput();

  const row = el('div', 't-time-range__row');
  row.append(
    field(t('diary.form.start'), 'form-start', startInput),
    field(t('diary.form.end'), 'form-end', endInput)
  );

  // One line for everything the two values mean: the range in 24-hour form (the
  // native picker may show AM/PM on a 12-hour device), the day it ends on, and
  // the duration. `aria-describedby` is how a screen reader reaches it from the
  // end field, since a time value cannot carry the day.
  const summary = el('p', 't-duration');
  const summaryOut = el('output');
  summaryOut.id = 'form-time-summary';
  summaryOut.setAttribute('for', 'form-start form-end');
  summary.append(summaryOut);
  endInput.setAttribute('aria-describedby', summaryOut.id);

  /** Shown only on the last day, where an entry cannot run past midnight. */
  const endHint = el('p', 't-hint');
  endHint.hidden = true;

  /** Last committed selection; the inputs are normalized to it on change. */
  const state = { dayIndex, start: startMinutes, end: endMinutes };

  /**
   * @param {number} start Day-relative start minute.
   * @param {number} end Day-relative end minute.
   */
  function renderSummary(start, end) {
    const range = `${formatClock(start, dayStartMinutes)} – ${formatClock(end, dayStartMinutes)}`;
    const nextDay = end >= MINUTES_PER_DAY ? ` ${t('diary.form.nextDay')}` : '';
    // Two unbreakable parts: a long entry wraps between "the range" and "the
    // duration", never inside "2 Std. 30 Min.".
    const rangePart = el('span', 't-duration__part', `${range}${nextDay}`);
    const durationPart = el(
      'span',
      't-duration__part',
      `· ${durationText(t, end - start)}`
    );
    summaryOut.replaceChildren(rangePart, document.createTextNode(' '), durationPart);
  }

  /**
   * Recompute the end for the current start/day, write both fields back and
   * report the new selection.
   *
   * @param {number | null} keep End that should survive when it is still
   *   reachable, or null for the default duration.
   */
  function commit(keep) {
    const clock = parseClock(startInput.value);
    const start = clock === null
      ? state.start
      : snapMinutes(toDayRelative(clock, dayStartMinutes), {
          min: 0,
          max: MINUTES_PER_DAY - STEP_MINUTES,
        });

    const isLast = state.dayIndex === lastIndex;
    const max = isLast ? MINUTES_PER_DAY : start + MINUTES_PER_DAY;
    const wanted = keep == null ? start + DEFAULT_DURATION_MINUTES : keep;
    const end = snapMinutes(
      wanted > start ? wanted : start + DEFAULT_DURATION_MINUTES,
      { min: start + STEP_MINUTES, max }
    );

    state.start = start;
    state.end = end;
    startInput.value = formatClock(start, dayStartMinutes);
    endInput.value = formatClock(end, dayStartMinutes);
    endHint.hidden = !isLast;
    if (isLast) endHint.textContent = t('diary.form.lastDayHint');

    renderSummary(state.start, state.end);
    onCommit();
  }

  // While a segmented field is being edited its value can be incomplete; update
  // the derived text only, never rewrite the field under the participant.
  function preview() {
    const clock = parseClock(startInput.value);
    const endClock = parseClock(endInput.value);
    if (clock === null || endClock === null) return;
    const start = toDayRelative(clock, dayStartMinutes);
    const end = resolveRangeEnd(start, endClock, {
      dayStartMinutes,
      isLastDay: state.dayIndex === lastIndex,
    });
    renderSummary(start, end);
  }

  startInput.addEventListener('change', () => commit(state.end));
  endInput.addEventListener('change', () => {
    const endClock = parseClock(endInput.value);
    commit(
      endClock === null
        ? null
        : resolveRangeEnd(state.start, endClock, {
            dayStartMinutes,
            isLastDay: state.dayIndex === lastIndex,
          })
    );
  });
  startInput.addEventListener('input', preview);
  endInput.addEventListener('input', preview);

  commit(endMinutes);

  return {
    row,
    summary,
    endHint,
    /** @returns {{ dayIndex: number, start: number, end: number }} */
    selection: () => ({ ...state }),
    /** @param {number} nextDayIndex */
    setDay(nextDayIndex) {
      state.dayIndex = nextDayIndex;
      commit(state.end);
    },
    /**
     * Move the start (neighbour snapping) and keep the length the participant
     * already chose.
     *
     * @param {number} nextStart Day-relative minute.
     * @param {number} keepDuration
     */
    setStart(nextStart, keepDuration) {
      state.start = nextStart;
      startInput.value = formatClock(nextStart, dayStartMinutes);
      commit(nextStart + keepDuration);
    },
    /** @returns {{ start: number, end: number } | null} null for an incomplete field. */
    read() {
      const startClock = parseClock(startInput.value);
      const endClock = parseClock(endInput.value);
      if (startClock === null || endClock === null) return null;
      const start = snapMinutes(toDayRelative(startClock, dayStartMinutes), {
        min: 0,
        max: MINUTES_PER_DAY - STEP_MINUTES,
      });
      return {
        start,
        end: resolveRangeEnd(start, endClock, {
          dayStartMinutes,
          isLastDay: state.dayIndex === lastIndex,
        }),
      };
    },
  };
}
