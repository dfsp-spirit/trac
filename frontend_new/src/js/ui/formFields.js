// @ts-check
/**
 * Small builders shared by the activity form: a labelled field, the time option
 * list and the multi-day chips. Kept apart so the form stays about behaviour.
 */
import { MINUTES_PER_DAY, STEP_MINUTES, formatClock } from '../domain/time.js';

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
 * A label and its control, stacked like every other field in the panel.
 *
 * @param {string} text
 * @param {string} id
 * @param {HTMLElement} control
 * @returns {HTMLElement}
 */
export function field(text, id, control) {
  const wrapper = el('div', 't-field');
  const label = el('label', null, text);
  label.htmlFor = id;
  control.id = id;
  wrapper.append(label, control);
  return wrapper;
}

/**
 * Every step between two clock minutes, labelled in the study's day frame. The
 * second day of the range is what makes "sleep 22:00 to 08:00" one entry.
 *
 * @param {number} from
 * @param {number} to
 * @param {number} dayStart
 * @param {boolean} markNextDay
 * @param {(key: string, params?: Record<string, string | number>) => string} t
 * @returns {HTMLOptionElement[]}
 */
export function timeOptions(from, to, dayStart, markNextDay, t) {
  const list = [];
  for (let minutes = from; minutes <= to; minutes += STEP_MINUTES) {
    let suffix = '';
    if (minutes >= MINUTES_PER_DAY) suffix = ` ${t('diary.form.nextDay')}`;
    else if (markNextDay && minutes === MINUTES_PER_DAY) suffix = ` ${t('diary.form.midnight')}`;
    list.push(new Option(`${formatClock(minutes, dayStart)}${suffix}`, String(minutes)));
  }
  return list;
}

/**
 * Day chips for "also on other days". The selected day is checked and marked, so
 * the copy set always contains the day the form shows.
 *
 * @param {Array<{ index: number, name: string, display_name: string }>} days
 * @returns {{ element: HTMLElement, inputs: HTMLInputElement[] }}
 */
export function dayChips(days) {
  const element = el('div', 't-days__grid');
  /** @type {HTMLInputElement[]} */
  const inputs = [];

  for (const day of days) {
    const chip = el('label', 't-day-chip');
    const input = el('input');
    input.type = 'checkbox';
    input.name = 'days';
    input.value = String(day.index);
    input.setAttribute('aria-label', day.display_name || day.name);
    const weekday = el('span', 't-day-chip__wd', (day.name || '').slice(0, 2));
    weekday.setAttribute('aria-hidden', 'true');
    chip.append(input, weekday);
    element.append(chip);
    inputs.push(input);
  }

  return { element, inputs };
}

/**
 * Mark the chip of the day the form is showing.
 *
 * @param {HTMLInputElement[]} inputs
 * @param {number} selectedDay
 */
export function syncChips(inputs, selectedDay) {
  for (const input of inputs) {
    const isCurrent = Number(input.value) === selectedDay;
    input.checked = isCurrent;
    input.closest('.t-day-chip')?.classList.toggle('t-day-chip--current', isCurrent);
  }
}
