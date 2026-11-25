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
 *   step?: number,
 *   minDurationMinutes?: number,
 *   defaultDurationMinutes?: number,
 *   preserveInitialRange?: boolean,
 * }} deps `onCommit` runs after every committed start/end/day change, so the
 *   form can refresh what is derived from the selection (chips, hints).
 *   `step`, `minDurationMinutes` and `defaultDurationMinutes` are the study's
 *   time grid (`domain/timing.js`).
 */
export function createTimeRange({
  t,
  dayStartMinutes,
  lastIndex,
  dayIndex,
  startMinutes,
  endMinutes,
  onCommit,
  step = STEP_MINUTES,
  minDurationMinutes = step,
  defaultDurationMinutes = DEFAULT_DURATION_MINUTES,
  preserveInitialRange = false,
}) {
  const startInput = timeInput(step);
  startInput.value = formatClock(startMinutes, dayStartMinutes);

  const endInput = timeInput(step);

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

  /**
   * Last committed selection; the inputs are normalized to it on change.
   * `preserve` keeps a stored row exactly as it is until the participant
   * changes something: a row saved under an older grid or a longer minimum must
   * survive being opened, or the exemption from the step/minimum rules would be
   * pointless (the form would rewrite the times on load).
   */
  const state = {
    dayIndex,
    start: startMinutes,
    end: endMinutes,
    preserve: preserveInitialRange,
  };

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
   * The last start the day allows. On the last day an entry cannot run past
   * midnight, so the start has to leave room for the study's minimum; earlier
   * days may cross into the next day and only stop at one step before the end.
   *
   * @returns {number}
   */
  function maxStartMinute() {
    return state.dayIndex === lastIndex
      ? MINUTES_PER_DAY - minDurationMinutes
      : MINUTES_PER_DAY - step;
  }

  /**
   * Recompute the end for the current start/day, write both fields back and
   * report the new selection.
   *
   * @param {number | null} keep End that should survive when it is still
   *   reachable, or null for the default duration.
   */
  function commit(keep) {
    state.preserve = false;
    const clock = parseClock(startInput.value);
    const start = clock === null
      ? state.start
      : snapMinutes(toDayRelative(clock, dayStartMinutes), {
          step,
          min: 0,
          max: maxStartMinute(),
        });

    const isLast = state.dayIndex === lastIndex;
    const max = isLast ? MINUTES_PER_DAY : start + MINUTES_PER_DAY;
    const wanted = keep == null ? start + defaultDurationMinutes : keep;
    const end = snapMinutes(
      wanted > start ? wanted : start + defaultDurationMinutes,
      { step, min: start + minDurationMinutes, max }
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
      minDurationMinutes,
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
            minDurationMinutes,
          })
    );
  });
  startInput.addEventListener('input', preview);
  endInput.addEventListener('input', preview);

  endInput.value = formatClock(endMinutes, dayStartMinutes);
  if (state.preserve) {
    renderSummary(state.start, state.end);
  } else {
    commit(endMinutes);
  }

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
      if (state.preserve) return { start: state.start, end: state.end };
      const startClock = parseClock(startInput.value);
      const endClock = parseClock(endInput.value);
      if (startClock === null || endClock === null) return null;
      const start = snapMinutes(toDayRelative(startClock, dayStartMinutes), {
        step,
        min: 0,
        max: maxStartMinute(),
      });
      return {
        start,
        end: resolveRangeEnd(start, endClock, {
          dayStartMinutes,
          isLastDay: state.dayIndex === lastIndex,
          minDurationMinutes,
        }),
      };
    },
  };
}
