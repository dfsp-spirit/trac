// @ts-check
/**
 * Step 2 of the activity panel: the chosen activity, its options and the time.
 *
 * Validation runs on submit, never while typing (the design-system rule), and it
 * uses the same domain functions the rest of the app uses, so an overlap the form
 * accepts is not refused by the server for a different reason.
 */
import { MINUTES_PER_DAY, STEP_MINUTES, toDayRelative } from '../domain/time.js';
import { validateActivity } from '../domain/validation.js';
import { dayChips, field, syncChips as syncChipsForSelection, timeOptions } from './formFields.js';

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
 * @param {HTMLElement} host
 * @param {{
 *   entry: import('./activitySearch.js').CatalogueEntry,
 *   days: Array<{ index: number, name: string, display_names?: Record<string, string>, display_name: string }>,
 *   language: string,
 *   t: (key: string, params?: Record<string, string | number>) => string,
 *   prefill: { dayIndex: number, startMinutes: number, endMinutes: number, childCode?: number | null },
 *   existing: Array<{ id: string, dayIndex: number, startMinutes: number, endMinutes: number, activityCode: string | number }>,
 *   dayStartMinutes: number,
 *   maxOverlap: number,
 *   mode: 'create' | 'edit',
 *   activity?: import('../domain/diary.js').ApiActivity | null,
 * }} view
 */
export function renderActivityForm(host, view) {
  const { entry, days, language, t, prefill, existing, dayStartMinutes, maxOverlap, mode } = view;
  const lastIndex = days.length - 1;
  const current = view.activity || null;

  const form = el('form', 't-form');
  form.noValidate = true;

  const chosen = el('div', 't-chosen');
  const swatch = el('span', 't-pat');
  swatch.setAttribute('aria-hidden', 'true');
  if (entry.color) swatch.style.background = entry.color;
  chosen.append(swatch, el('span', 't-chosen__text', entry.name));
  form.append(chosen);

  /** @type {HTMLSelectElement | null} */
  let childSelect = null;
  if (entry.children.length) {
    childSelect = el('select', 't-select t-select--text');
    childSelect.append(new Option(t('diary.form.chooseOption'), ''));
    for (const child of entry.children) {
      childSelect.append(new Option(child.name, String(child.code)));
    }
    if (current && current.parent_activity_code === entry.code) {
      childSelect.value = String(current.activity_code);
    } else if (prefill.childCode) {
      // Chosen in the search results, so the form opens ready to save.
      childSelect.value = String(prefill.childCode);
    }
    form.append(field(t('diary.form.option'), 'form-child', childSelect));
  }

  /** @type {HTMLInputElement | null} */
  let textInput = null;
  if (entry.isCustomInput) {
    textInput = el('input', 't-input');
    textInput.type = 'text';
    textInput.maxLength = 200;
    textInput.autocomplete = 'off';
    if (current && current.parent_activity_code === entry.code) {
      textInput.value = current.activity_name;
    }
    form.append(field(t('diary.form.what'), 'form-text', textInput));
  }

  /** @type {HTMLSelectElement | null} */
  let frequencySelect = null;
  if (entry.frequencyOptions.length) {
    frequencySelect = el('select', 't-select t-select--text');
    frequencySelect.append(new Option(t('diary.form.frequencyUnset'), ''));
    for (const option of entry.frequencyOptions) {
      frequencySelect.append(new Option(option.label, option.key));
    }
    if (current?.frequency_key) frequencySelect.value = current.frequency_key;
    form.append(field(t('diary.form.frequency'), 'form-frequency', frequencySelect));
  }

  const timeFieldset = el('fieldset', 't-time-range');
  timeFieldset.append(el('legend', null, t('diary.form.when')));

  const daySelect = el('select', 't-select t-select--text');
  for (const day of days) {
    const label = (day.display_names && day.display_names[language]) || day.display_name || day.name;
    daySelect.append(new Option(label, String(day.index)));
  }
  if (current) daySelect.value = String(current.day_label_index);
  else daySelect.value = String(prefill.dayIndex);
  const dayField = field(t('diary.form.day'), 'form-day', daySelect);

  const startSelect = el('select', 't-select');
  startSelect.append(...timeOptions(0, MINUTES_PER_DAY - STEP_MINUTES, dayStartMinutes, false, t));
  startSelect.value = String(current ? current.start_minutes : prefill.startMinutes);

  const endSelect = el('select', 't-select');
  const row = el('div', 't-time-range__row');
  row.append(
    field(t('diary.form.start'), 'form-start', startSelect),
    field(t('diary.form.end'), 'form-end', endSelect)
  );

  const duration = el('p', 't-duration');
  const durationOut = el('output');
  durationOut.setAttribute('for', 'form-start form-end');
  duration.append(t('diary.form.lasts'), ' ', durationOut);

  const endHint = el('p', 't-hint');
  endHint.hidden = true;

  timeFieldset.append(dayField, row, duration, endHint);
  form.append(timeFieldset);

  const daysFieldset = el('fieldset', 't-days');
  daysFieldset.append(el('legend', null, t('diary.form.alsoOn')));
  const chips = dayChips(days);
  const chipInputs = chips.inputs;
  daysFieldset.append(chips.element);
  if (mode === 'edit') daysFieldset.hidden = true;
  form.append(daysFieldset);

  const error = el('div', 't-notice t-notice--attention');
  error.tabIndex = -1;
  error.hidden = true;
  const errorBody = el('div', 't-notice__body');
  const errorTitle = el('p', 't-notice__title');
  const errorText = el('p');
  errorBody.append(errorTitle, errorText);
  error.append(errorBody);
  form.append(error);

  host.replaceChildren(form);

  /** @param {number} keep */
  function fillEnd(keep) {
    const start = Number(startSelect.value);
    const dayIndex = Number(daySelect.value);
    const isLast = dayIndex === lastIndex;
    const max = isLast ? MINUTES_PER_DAY : start + MINUTES_PER_DAY;
    endSelect.replaceChildren(...timeOptions(start + STEP_MINUTES, max, dayStartMinutes, !isLast, t));

    endHint.hidden = !isLast;
    if (isLast) endHint.textContent = t('diary.form.lastDayHint');

    const wanted = Number(keep);
    endSelect.value = String(
      Number.isFinite(wanted) && wanted > start && wanted <= max
        ? wanted
        : Math.min(start + 4 * STEP_MINUTES, max)
    );
    syncChips();
    showDuration();
  }

  function showDuration() {
    const minutes = Number(endSelect.value) - Number(startSelect.value);
    const hours = Math.floor(minutes / 60);
    const rest = minutes % 60;
    const parts = [];
    if (hours) parts.push(t('diary.form.hours', { count: hours }));
    if (rest) parts.push(t('diary.form.minutes', { count: rest }));
    durationOut.textContent = parts.join(' ');
  }

  function syncChips() {
    syncChipsForSelection(chipInputs, Number(daySelect.value));
  }

  startSelect.addEventListener('change', () => fillEnd(Number(endSelect.value)));
  endSelect.addEventListener('change', showDuration);
  daySelect.addEventListener('change', () => fillEnd(Number(endSelect.value)));

  fillEnd(current ? current.end_minutes : prefill.endMinutes);

  /** @param {string} title @param {string} message */
  function showError(title, message) {
    errorTitle.textContent = title;
    errorText.textContent = message;
    error.hidden = false;
    error.focus();
  }

  /**
   * @returns {{ ok: true, values: Record<string, unknown> } | { ok: false, code: string, meta?: Record<string, unknown> }}
   */
  function read() {
    let activityCode = entry.code;
    let activityName = entry.name;
    let parentCode = null;

    if (childSelect) {
      const value = Number(childSelect.value);
      if (!childSelect.value) return { ok: false, code: 'form.chooseOption' };
      activityCode = value;
      const child = entry.children.find((item) => item.code === value);
      activityName = child ? child.name : entry.name;
      parentCode = entry.code;
    }

    if (textInput) {
      const text = textInput.value.trim();
      if (!text) return { ok: false, code: 'form.needsText' };
      activityName = `${entry.name}: ${text}`;
      parentCode = entry.code;
    }

    const dayIndex = Number(daySelect.value);
    const start = Number(startSelect.value);
    const end = Number(endSelect.value);

    const relativeStart = toDayRelative(start, dayStartMinutes);
    let relativeEnd = toDayRelative(end, dayStartMinutes);
    if (relativeEnd <= relativeStart) relativeEnd += MINUTES_PER_DAY;

    const result = validateActivity({
      candidate: {
        id: current ? current.client_uuid : 'new',
        dayIndex,
        startMinutes: relativeStart,
        endMinutes: relativeEnd,
        activityCode,
      },
      existing,
      dayCount: days.length,
      maxOverlap,
      ignoreId: current ? current.client_uuid : null,
      step: STEP_MINUTES,
    });
    if (!result.ok) return result;

    const targets = mode === 'edit'
      ? [dayIndex]
      : [...new Set([dayIndex, ...chipInputs.filter((input) => input.checked).map((input) => Number(input.value))])];

    return {
      ok: true,
      values: {
        activity_code: activityCode,
        activity_name: activityName,
        category: entry.category,
        color: entry.color,
        parent_activity_code: parentCode,
        frequency_key: frequencySelect?.value || null,
        day_label_index: dayIndex,
        start_minutes: start,
        end_minutes: end,
        day_label_indexes: targets.sort((a, b) => a - b),
      },
    };
  }

  return { read, showError, form, startSelect };
}
