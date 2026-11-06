// @ts-check
/**
 * The line under "Also on other days?" that says what the ticked days will do.
 *
 * `domain/validation.js` already knew which days would take the entry
 * (`planMultiDayCreate`), but only the write path used it: a participant who
 * ticked five days found out from the toast afterwards, and that toast named
 * only the first day that was dropped. This runs the same plan while the form is
 * still open.
 *
 * The chips stay enabled on purpose. Whether a day can take the entry depends on
 * the range being picked right now - and on the other chips, because a night
 * that spills into the next morning can fill it - so a disabled chip would flip
 * back and forth while the end time is still moving, and could not say why.
 */
import { dayLabelList } from '../domain/diary.js';
import { MINUTES_PER_DAY, STEP_MINUTES, toDayRelative } from '../domain/time.js';
import { planMultiDayCreate } from '../domain/validation.js';
import { el } from './dom.js';

/** @typedef {(key: string, params?: Record<string, string | number>) => string} Translator */
/** @typedef {import('../domain/validation.js').MultiDayTarget} MultiDayTarget */
/** @typedef {Array<{ index: number, name: string, displayName?: string | null, displayNames?: Record<string, string>, display_name?: string | null, display_names?: Record<string, string> }>} DayList */

/**
 * The sentence for one plan, or an empty string when the form should stay quiet.
 *
 * Quiet means "nothing interesting to report": a single day (the everyday save),
 * or a plan in which nothing lands - then the anchor day is refused too and the
 * form's own error notice is the message that matters.
 *
 * @param {Translator} t
 * @param {MultiDayTarget[]} plan
 * @param {DayList} days
 * @param {string} language
 * @returns {string}
 */
export function previewText(t, plan, days, language) {
  const skipped = plan
    .filter((target) => target.status === 'skipped')
    .map((target) => target.dayIndex);
  const added = plan.length - skipped.length;
  if (plan.length < 2 || added === 0) return '';
  if (skipped.length === 0) return t('diary.form.alsoOnAll', { count: added });
  return t('diary.form.alsoOnPartial', {
    added,
    total: plan.length,
    days: dayLabelList(skipped, days, language),
  });
}

/**
 * @param {{
 *   t: Translator,
 *   days: DayList,
 *   language: string,
 *   existing: Array<{ id: string, dayIndex: number, startMinutes: number, endMinutes: number, activityCode: string | number }>,
 *   dayStartMinutes: number,
 *   maxOverlap: number,
 *   getSelection: () => { dayIndex: number, start: number, end: number, activityCode: string | number, checkedDays: number[] },
 * }} deps `getSelection` reads the live selects and the ticked chips, because the
 *   answer changes with the range, not only with the days.
 */
export function createMultiDayHint(deps) {
  const { t, days, language, existing, dayStartMinutes, maxOverlap, getSelection } = deps;

  const element = el('p', 't-hint');
  element.hidden = true;
  element.dataset.slot = 'also-on-hint';

  function refresh() {
    const selection = getSelection();
    const relativeStart = toDayRelative(selection.start, dayStartMinutes);
    let relativeEnd = toDayRelative(selection.end, dayStartMinutes);
    if (relativeEnd <= relativeStart) relativeEnd += MINUTES_PER_DAY;

    const plan = planMultiDayCreate({
      candidate: {
        id: 'new',
        dayIndex: selection.dayIndex,
        startMinutes: relativeStart,
        endMinutes: relativeEnd,
        activityCode: selection.activityCode,
      },
      targets: [...new Set([selection.dayIndex, ...selection.checkedDays])],
      dayCount: days.length,
      existing,
      maxOverlap,
      step: STEP_MINUTES,
    });

    const text = previewText(t, plan, days, language);
    element.textContent = text;
    element.hidden = !text;
  }

  return { element, refresh };
}
