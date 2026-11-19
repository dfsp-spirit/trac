// @ts-check
/**
 * The one-click target presets in the copy dialog: "All work days" and
 * "Weekend".
 *
 * A preset means "exactly these": it replaces the selection, so pressing the
 * second one does not leave the first one's days ticked. The source day is
 * never a target and is filtered out; a group that ends up empty (a study with
 * no weekend, say) renders no button. Nothing is rendered at all when the
 * study's day names cannot be classified - the individual chips still work.
 */
import { weekdayGroups } from '../domain/dayCopy.js';
import { el } from './dom.js';

/** @typedef {(key: string, params?: Record<string, string | number>) => string} Translator */

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
 *   days: Array<{ index: number, name: string }>,
 *   sourceDay: number | null,
 *   inputs: HTMLInputElement[],
 *   t: Translator,
 * }} view
 * @returns {HTMLElement | null}
 */
export function renderTargetShortcuts({ days, sourceDay, inputs, t }) {
  const groups = weekdayGroups(days);
  if (!groups) return null;

  /** @param {number[]} indexes */
  const selectable = (indexes) => indexes.filter((index) => index !== sourceDay);

  const presets = /** @type {Array<[string, number[]]>} */ ([
    ['diary.copy.workdays', selectable(groups.workdays)],
    ['diary.copy.weekend', selectable(groups.weekend)],
  ]).filter(([, indexes]) => indexes.length > 0);
  if (!presets.length) return null;

  const wrap = el('div', 't-days__shortcuts');
  wrap.setAttribute('role', 'group');
  const label = el('span', 't-days__shortcuts-label', t('diary.copy.shortcuts'));
  label.id = 'copy-day-shortcuts-label';
  wrap.setAttribute('aria-labelledby', label.id);
  wrap.append(label);

  for (const [key, indexes] of presets) {
    const button = el('button', 't-btn t-btn--secondary t-btn--sm', t(key));
    button.type = 'button';
    button.addEventListener('click', () => selectTargets(inputs, indexes));
    wrap.append(button);
  }
  return wrap;
}
