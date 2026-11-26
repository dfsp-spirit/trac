// @ts-check
/**
 * The free-text field of the activity form ("Was haben Sie gemacht?").
 *
 * A custom input is a property of a catalogue **row**, and a sub-activity is a
 * row: the pilot study's "Sport in Innenräumen (z.B. Schwimmen, Kurse)" asks for
 * the participant's own words although its parent does not. So the field belongs
 * to whichever row the form currently saves - the entry itself, or the chosen
 * sub-activity - and it has to appear and disappear with that choice.
 *
 * The compose/split pair stays in `domain/activityName.js`, because the stored
 * name is the authoritative value for the timeline, the export and the server.
 *
 * The prompt above the field follows the same row: a catalogue row may name its
 * own question (`custom_input_question`), and the form falls back to the
 * localized generic one when it does not.
 */
import { composeCustomName, customActivityText } from '../domain/activityName.js';
import { el } from './dom.js';
import { field } from './formFields.js';

/**
 * @typedef {import('./activitySearch.js').CatalogueChild} CatalogueChild
 * @typedef {{
 *   code: number,
 *   name: string,
 *   customInput?: boolean,
 *   customInputQuestion?: string | null,
 * }} CustomRow
 * @typedef {(key: string, params?: Record<string, string | number>) => string} Translator
 */

/**
 * @param {{
 *   entry: import('./activitySearch.js').CatalogueEntry,
 *   childSelect: HTMLSelectElement | null,
 *   t: Translator,
 *   storedActivity?: { parent_activity_code?: number | null, activity_name?: string } | null,
 *   prefillText?: string | null,
 * }} view `storedActivity` is the row being edited: its name carries the prefix,
 *   so the field shows only the participant's words.
 * @returns {{
 *   element: HTMLElement | null,
 *   sync: () => void,
 *   row: () => CustomRow | null,
 *   result: () => { name: string } | { error: 'form.needsText' } | null,
 * }}
 *   `element` is null when neither the entry nor any of its sub-activities takes
 *   free text; `row()` is the custom row currently selected (null otherwise);
 *   `result()` is the stored name, an error when the field is empty, or null when
 *   this form saves no text at all.
 */
export function createCustomField({
  entry,
  childSelect,
  t,
  storedActivity = null,
  prefillText = null,
}) {
  /**
   * The chosen sub-activity, when it is a custom input of its own.
   *
   * @returns {CatalogueChild | null}
   */
  function selectedCustomChild() {
    if (!childSelect || !childSelect.value) return null;
    const code = Number(childSelect.value);
    const child = entry.children.find((item) => item.code === code);
    return child && child.customInput ? child : null;
  }

  /**
   * The row the typed words belong to. A custom entry keeps the parent's name as
   * the prefix; a custom sub-activity uses its own.
   *
   * @returns {CustomRow | null}
   */
  function row() {
    if (entry.isCustomInput) {
      return {
        code: entry.code,
        name: entry.name,
        customInputQuestion: entry.customInputQuestion,
      };
    }
    return selectedCustomChild();
  }

  /** @type {HTMLInputElement | null} */
  let input = null;
  /** @type {HTMLElement | null} */
  let element = null;
  /** @type {HTMLLabelElement | null} */
  let label = null;

  if (entry.isCustomInput || entry.children.some((child) => child.customInput)) {
    input = el('input', 't-input');
    input.type = 'text';
    input.maxLength = 200;
    input.autocomplete = 'off';
    element = field(t('diary.form.what'), 'form-text', input);
    label = element.querySelector('label');

    const target = row();
    if (storedActivity && target && storedActivity.parent_activity_code === entry.code) {
      input.value = customActivityText(target.name, storedActivity.activity_name);
    } else if (prefillText) {
      input.value = prefillText;
    }
  }

  /**
   * Show the field only while a custom row is the one being saved, and use that
   * row's own prompt when it names one.
   */
  function sync() {
    if (!element) return;
    const target = row();
    element.hidden = target === null;
    if (label) {
      label.textContent = target?.customInputQuestion || t('diary.form.what');
    }
  }

  /** @returns {{ name: string } | { error: 'form.needsText' } | null} */
  function result() {
    const target = row();
    if (!target) return null;
    const text = input ? input.value.trim() : '';
    if (!text) return { error: 'form.needsText' };
    return { name: composeCustomName(target.name, text) };
  }

  return { element, sync, row, result };
}
