// @ts-check
/**
 * Small builders shared by the activity form: a labelled field, the time field
 * and the multi-day chips. Kept apart so the form stays about behaviour.
 */
import { dayLabel } from '../domain/diary.js';
import { STEP_MINUTES } from '../domain/time.js';

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
 * A 24-hour time field. The browser supplies the picker: a segmented, typeable
 * field on desktop and the OS dial/wheel on phones, so the form no longer owns a
 * 144-entry list. `step` is the study's grid (`domain/timing.js`); the form
 * snaps a value that lands between steps before it is used, and the attribute
 * makes Chromium/Firefox offer exactly those values.
 *
 * @param {number} [step]
 * @returns {HTMLInputElement}
 */
export function timeInput(step = STEP_MINUTES) {
  const input = el('input', 't-input t-time');
  input.type = 'time';
  input.step = String(step * 60);
  return input;
}

/**
 * Day chips for "also on other days". The selected day is checked and marked, so
 * the copy set always contains the day the form shows.
 *
 * The marker is the first two letters of the day's name *in the interface
 * language* ("Mo", "Di", "Mi" in German, "Må", "Ti" in Swedish) - the internal
 * name is English, so slicing it gave "mo", "tu", "we" to everyone.
 *
 * `options` exists for the copy dialog, which reuses the same grid with two
 * differences: the chips that already hold entries get a dot, and the source day
 * is inert (it is where the entries come from, not a target). Both states are
 * part of the accessible name, because a dot alone says nothing to a screen
 * reader.
 *
 * @param {Array<{ index: number, name: string, display_name?: string | null, display_names?: Record<string, string> }>} days
 * @param {string} language
 * @param {{ filled?: number[], source?: number | null, filledLabel?: string, sourceLabel?: string }} [options]
 * @returns {{ element: HTMLElement, inputs: HTMLInputElement[] }}
 */
export function dayChips(days, language = '', options = {}) {
  const { filled = [], source = null, filledLabel = '', sourceLabel = '' } = options;
  const element = el('div', 't-days__grid');
  /** @type {HTMLInputElement[]} */
  const inputs = [];

  for (const day of days) {
    const chip = el('label', 't-day-chip');
    const input = el('input');
    input.type = 'checkbox';
    input.name = 'days';
    input.value = String(day.index);
    const label = dayLabel(day, language);
    const isSource = source === day.index;
    const isFilled = filled.includes(day.index);

    if (isSource) {
      chip.classList.add('t-day-chip--source');
      input.disabled = true;
    }
    input.setAttribute(
      'aria-label',
      isSource && sourceLabel
        ? `${label}, ${sourceLabel}`
        : isFilled && filledLabel
          ? `${label}, ${filledLabel}`
          : label
    );

    const weekday = el('span', 't-day-chip__wd', label.slice(0, 2));
    weekday.setAttribute('aria-hidden', 'true');
    // The chip's selected look is a class, not `:has(input:checked)`, because the
    // input is invisible and this is the only signal that the day is picked
    // (components.css; `:has` only reached Firefox in 121).
    input.addEventListener('change', () =>
      chip.classList.toggle('t-day-chip--checked', input.checked)
    );
    chip.append(input, weekday);

    if (isFilled && !isSource) {
      chip.classList.add('t-day-chip--filled');
      const mark = el('span', 't-day-chip__mark');
      mark.setAttribute('aria-hidden', 'true');
      chip.append(mark);
    }

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
    const chip = input.closest('.t-day-chip');
    chip?.classList.toggle('t-day-chip--current', isCurrent);
    chip?.classList.toggle('t-day-chip--checked', isCurrent);
  }
}

/**
 * "1 Std. 30 Min." for a duration in minutes, skipping the empty halves.
 *
 * @param {(key: string, params?: Record<string, string | number>) => string} t
 * @param {number} minutes
 * @returns {string}
 */
export function durationText(t, minutes) {
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  const parts = [];
  if (hours) parts.push(t('diary.form.hours', { count: hours }));
  if (rest) parts.push(t('diary.form.minutes', { count: rest }));
  return parts.join(' ');
}
