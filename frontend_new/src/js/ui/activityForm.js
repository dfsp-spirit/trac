// @ts-check
/**
 * Step 2 of the activity panel: the chosen activity, its options and the time.
 *
 * Validation runs on submit, never while typing (the design-system rule), and it
 * uses the same domain functions the rest of the app uses, so an overlap the form
 * accepts is not refused by the server for a different reason.
 */
import { STEP_MINUTES } from '../domain/time.js';
import { validateActivity } from '../domain/validation.js';
import { composeCustomName, customActivityText } from '../domain/activityName.js';
import { dayLabel } from '../domain/diary.js';
import { el } from './dom.js';
import { dayChips, field, syncChips as syncChipsForSelection } from './formFields.js';
import { createMultiDayHint } from './multiDayHint.js';
import { createTimeNeighbours } from './timeNeighbours.js';
import { createTimeRange } from './timeRange.js';

/**
 * @param {HTMLElement} host
 * @param {{
 *   entry: import('./activitySearch.js').CatalogueEntry,
 *   days: Array<{ index: number, name: string, display_names?: Record<string, string>, display_name: string }>,
 *   language: string,
 *   t: (key: string, params?: Record<string, string | number>) => string,
 *   prefill: { dayIndex: number, startMinutes: number, endMinutes: number, childCode?: number | null, text?: string | null },
 *   existing: Array<{ id: string, dayIndex: number, startMinutes: number, endMinutes: number, activityCode: string | number, name?: string }>,
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
    // A stored name carries the entry prefix; a shortcut holds just the text.
    if (current && current.parent_activity_code === entry.code) {
      textInput.value = customActivityText(entry.name, current.activity_name);
    } else if (prefill.text) {
      textInput.value = prefill.text;
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
    daySelect.append(new Option(dayLabel(day, language), String(day.index)));
  }
  if (current) daySelect.value = String(current.day_label_index);
  else daySelect.value = String(prefill.dayIndex);
  const dayField = field(t('diary.form.day'), 'form-day', daySelect);

  // Chips and hints refresh after every committed time change; the callback is
  // late-bound because they are built below the control.
  let refreshDerived = () => {};

  const timeRange = createTimeRange({
    t,
    dayStartMinutes,
    lastIndex,
    dayIndex: Number(daySelect.value),
    startMinutes: current ? current.start_minutes : prefill.startMinutes,
    endMinutes: current ? current.end_minutes : prefill.endMinutes,
    onCommit: () => refreshDerived(),
  });

  // `days`/`language` label a neighbour that sits on another day.
  const neighbours = createTimeNeighbours({
    t, dayStartMinutes, existing, days, language,
    getSelection: () => timeRange.selection(),
    getCurrentId: () => (current ? current.client_uuid : null),
    // Snapping keeps the length the participant already chose.
    onSnap: (start) => {
      const selection = timeRange.selection();
      timeRange.setStart(start, selection.end - selection.start);
    },
  });

  // The context block goes last: everything above it belongs to the entry being
  // edited, so the block can close the section instead of splitting it in two.
  timeFieldset.append(
    dayField,
    timeRange.row,
    timeRange.summary,
    timeRange.endHint,
    neighbours.element
  );
  form.append(timeFieldset);

  const daysFieldset = el('fieldset', 't-days');
  daysFieldset.append(el('legend', null, t('diary.form.alsoOn')));
  const chips = dayChips(days, language);
  const chipInputs = chips.inputs;
  daysFieldset.append(chips.element);
  if (mode === 'edit') daysFieldset.hidden = true;

  const multiDay = createMultiDayHint({
    t, days, language, existing, dayStartMinutes, maxOverlap,
    getSelection: () => ({
      ...timeRange.selection(),
      activityCode: childSelect && childSelect.value ? Number(childSelect.value) : entry.code,
      checkedDays: chipInputs.filter((input) => input.checked).map((input) => Number(input.value)),
    }),
  });
  daysFieldset.append(multiDay.element);
  for (const input of chipInputs) input.addEventListener('change', multiDay.refresh);
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

  refreshDerived = () => {
    syncChipsForSelection(chipInputs, Number(daySelect.value));
    neighbours.refresh();
    multiDay.refresh();
  };
  refreshDerived();

  daySelect.addEventListener('change', () => timeRange.setDay(Number(daySelect.value)));

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
      activityName = composeCustomName(entry.name, text);
      parentCode = entry.code;
    }

    const dayIndex = Number(daySelect.value);
    const range = timeRange.read();
    if (range === null) return { ok: false, code: 'time.end_not_after_start' };
    const { start, end } = range;

    const result = validateActivity({
      candidate: {
        id: current ? current.client_uuid : 'new',
        dayIndex,
        startMinutes: start,
        endMinutes: end,
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

  return { read, showError, form };
}
