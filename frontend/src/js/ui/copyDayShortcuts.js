// @ts-check
/**
 * The one-click target presets in the copy dialog.
 *
 * The groups are study configuration (`day_groups` in studies_config.json), not
 * an app concept: whether "all work days" means Mon-Fri, Sun-Thu or a school
 * week is the researcher's decision, and the API has already resolved each
 * group to day indexes. A preset means "exactly these": it replaces the
 * selection, so pressing a second one does not leave the first one's days
 * ticked. The source day is never a target and is filtered out; a group that
 * ends up empty renders no button. A study without day groups gets no section.
 */
import { localizedText } from '../domain/diary.js';
import { el } from './dom.js';

/** @typedef {(key: string, params?: Record<string, string | number>) => string} Translator */
/** @typedef {import('../domain/diary.js').ApiDiary['day_groups'][number]} DayGroup */

/**
 * Replace the checked state of the target chips.
 *
 * The chips own their checked look, so the change goes through the same
 * `change` listener a tap uses - setting `checked` alone would leave the chip
 * looking unselected.
 *
 * @param {HTMLInputElement[]} inputs
 * @param {number[]} indexes
 */
export function selectTargets(inputs, indexes) {
  const wanted = new Set(indexes);
  for (const input of inputs) {
    if (input.disabled) continue;
    input.checked = wanted.has(Number(input.value));
    input.dispatchEvent(new Event('change'));
  }
}

/**
 * @param {{
 *   groups: DayGroup[] | null | undefined,
 *   sourceDay: number | null,
 *   inputs: HTMLInputElement[],
 *   t: Translator,
 *   language: string,
 *   defaultLanguage: string | null | undefined,
 * }} view
 * @returns {HTMLElement | null}
 */
export function renderTargetShortcuts({
  groups,
  sourceDay,
  inputs,
  t,
  language,
  defaultLanguage,
}) {
  /** @type {Array<{ key: string, text: string, indexes: number[] }>} */
  const presets = [];
  for (const group of groups || []) {
    const text = localizedText(group?.names, language, defaultLanguage);
    const indexes = (group?.day_indexes || []).filter((index) => index !== sourceDay);
    if (!text || !indexes.length) continue;
    presets.push({ key: String(group.key ?? text), text, indexes });
  }
  if (!presets.length) return null;

  const wrap = el('div', 't-days__shortcuts');
  wrap.setAttribute('role', 'group');
  const label = el('span', 't-days__shortcuts-label', t('diary.copy.shortcuts'));
  label.id = 'copy-day-shortcuts-label';
  wrap.setAttribute('aria-labelledby', label.id);
  wrap.append(label);

  for (const preset of presets) {
    const button = el('button', 't-btn t-btn--secondary t-btn--sm', preset.text);
    button.type = 'button';
    button.dataset.group = preset.key;
    button.addEventListener('click', () => selectTargets(inputs, preset.indexes));
    wrap.append(button);
  }
  return wrap;
}
