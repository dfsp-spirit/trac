// @ts-check
/**
 * The copy dialog (D18, D19): pick the source day, tick the days that become
 * like it, copy.
 *
 * The source is its own block above the grid, never a chip among the targets:
 * "where do I copy from" and "where do I copy to" must not be told apart by a
 * border style. The chips are the activity form's component; their dot marks a
 * day that already holds entries, so what is at stake is visible before ticking.
 * No confirmation step: the preview names what will be overwritten, the button
 * says "and overwrite", and the caller offers an undo (D9).
 */
import { copyableDays, copySource, overwrites, planCopy } from '../domain/dayCopy.js';
import { dayLabel } from '../domain/diary.js';
import { el, icon } from './dom.js';
import { previewText, sourceDetail } from './copyDayText.js';
import { dayChips } from './formFields.js';
import { describeError } from './messages.js';
import { renderTargetShortcuts } from './copyDayShortcuts.js';
import { notice as noticeBox } from './notice.js';

/** @typedef {(key: string, params?: Record<string, string | number>) => string} Translator */
/** @typedef {import('../domain/diary.js').ApiDiary} ApiDiary */
/**
 * @param {{
 *   root: HTMLElement,
 *   t: Translator,
 *   tCount: (key: string, count: number) => string,
 *   getDiary: () => ApiDiary | null,
 *   getLanguage: () => string,
 *   getCurrentDay: () => number,
 *   onCopy: (body: { source_day_index: number, target_day_indexes: number[] }) => Promise<any>,
 *   onCopied: (result: any, context: { plan: import('../domain/dayCopy.js').CopyTarget[], days: ApiDiary['days'], language: string }) => void,
 * }} deps `onCopied` runs after the server accepted the copy and before the
 *   dialog closes, so the caller can offer the undo without owning any markup.
 */
export function createCopyDayDialog({
  root,
  t,
  tCount,
  getDiary,
  getLanguage,
  getCurrentDay,
  onCopy,
  onCopied,
}) {
  const dialog = el('dialog', 't-modal t-modal--centred');
  dialog.id = 'copy-day-dialog';

  const head = el('div', 't-modal__head');
  const title = el('h2');
  title.id = 'copy-day-title';
  const closeButton = el('button', 't-icon-btn');
  closeButton.type = 'button';
  closeButton.setAttribute('aria-label', t('diary.shell.close'));
  closeButton.append(icon(['M6 6l12 12M18 6L6 18']));
  head.append(title, closeButton);

  const body = el('div', 't-modal__body');
  const foot = el('div', 't-modal__foot');
  dialog.append(head, body, foot);
  dialog.setAttribute('aria-labelledby', title.id);
  root.append(dialog);

  /** @type {number | null} */
  let sourceDay = null;
  let editingSource = false;
  let busy = false;
  /** @type {HTMLInputElement[]} */
  let chipInputs = [];
  /** @type {HTMLButtonElement | null} */
  let submit = null;
  /** @type {HTMLElement | null} */
  let hint = null;
  /** @type {HTMLElement | null} */
  let focusAfterRender = null;

  function close() {
    if (dialog.open) dialog.close();
    busy = false;
  }

  /**
   * The source block: a receipt of the day the entries come from, or - while none
   * is chosen - the select that picks it.
   *
   * @param {ApiDiary} current
   * @param {string} language
   */
  function renderSource(current, language) {
    const copyable = copyableDays(current);

    if (editingSource || sourceDay === null) {
      const select = el('select', 't-select t-select--text');
      select.id = 'copy-source-day';
      const placeholder = new Option(t('diary.copy.selectSource'), '');
      select.append(placeholder);
      for (const index of copyable) {
        const day = current.days[index];
        if (day) select.append(new Option(dayLabel(day, language), String(index)));
      }
      select.value = sourceDay === null ? '' : String(sourceDay);
      select.addEventListener('change', () => {
        sourceDay = select.value === '' ? null : Number(select.value);
        editingSource = false;
        render();
      });
      focusAfterRender = select;

      const field = el('div', 't-field');
      const label = el('label', 't-label', t('diary.copy.source'));
      label.htmlFor = select.id;
      field.append(label, select);
      return field;
    }

    const day = current.days[sourceDay];
    const source = copySource(current, sourceDay);
    const block = el('div', 't-chosen t-copy-source');
    const text = el('div', 't-chosen__text');
    text.append(el('p', 't-copy-source__name', day ? dayLabel(day, language) : ''));
    text.append(
      el(
        'p',
        't-hint',
        sourceDetail(t, tCount, source, current.study.day_start_minutes || 0)
      )
    );
    block.append(text);

    const change = el('button', 't-btn t-btn--ghost t-btn--sm', t('diary.copy.change'));
    change.type = 'button';
    change.addEventListener('click', () => {
      editingSource = true;
      render();
    });
    block.append(change);
    return block;
  }

  /** @returns {number[]} */
  function checkedTargets() {
    return chipInputs.filter((input) => input.checked).map((input) => Number(input.value));
  }

  /**
   * @param {ApiDiary} current
   * @returns {import('../domain/dayCopy.js').CopyTarget[]}
   */
  function currentPlan(current) {
    if (sourceDay === null) return [];
    return planCopy({
      diary: current,
      sourceIndex: sourceDay,
      targetIndexes: checkedTargets(),
      maxOverlap: current.timeline?.max_overlap ?? 2,
    });
  }

  function updatePreview() {
    const current = getDiary();
    if (!current || !hint) return;
    const plan = currentPlan(current);
    const text = previewText(t, tCount, {
      plan,
      days: current.days,
      language: getLanguage(),
      hasSource: sourceDay !== null,
      hasTargets: checkedTargets().length > 0,
    });
    hint.textContent = text;
    hint.hidden = text === '';

    if (submit) {
      const accepted = plan.filter((target) => target.status === 'copied').length;
      submit.disabled = busy || accepted === 0;
      submit.textContent = overwrites(plan).length
        ? t('diary.copy.submitReplace')
        : t('diary.copy.submit');
    }
  }

  function render() {
    const current = getDiary();
    if (!current) return;
    const language = getLanguage();
    const filled = copyableDays(current).filter((index) => index !== sourceDay);

    title.textContent = t('diary.copy.title');

    const fieldset = el('fieldset', 't-days');
    fieldset.append(el('legend', null, t('diary.copy.targets')));
    const chips = dayChips(current.days, language, {
      filled,
      source: sourceDay,
      filledLabel: t('diary.copy.chipFilled'),
      sourceLabel: t('diary.copy.chipSource'),
    });
    chipInputs = chips.inputs;
    for (const input of chipInputs) input.addEventListener('change', () => updatePreview());
    const shortcuts = renderTargetShortcuts({
      days: current.days,
      sourceDay,
      inputs: chipInputs,
      t,
    });
    if (shortcuts) fieldset.append(shortcuts);
    fieldset.append(chips.element);

    const preview = el('p', 't-hint');
    preview.setAttribute('aria-live', 'polite');
    preview.dataset.slot = 'copy-hint';
    hint = preview;
    fieldset.append(preview);

    body.replaceChildren(renderSource(current, language), fieldset);

    const primary = el('button', 't-btn t-btn--primary t-btn--block', t('diary.copy.submit'));
    primary.type = 'button';
    primary.dataset.slot = 'copy-submit';
    primary.addEventListener('click', () => void send());
    submit = primary;

    const cancel = el('button', 't-btn t-btn--secondary t-btn--block', t('diary.copy.cancel'));
    cancel.type = 'button';
    cancel.addEventListener('click', () => close());
    foot.replaceChildren(primary, cancel);

    updatePreview();

    const focusTarget = focusAfterRender;
    focusAfterRender = null;
    if (focusTarget) focusTarget.focus();
  }

  async function send() {
    const current = getDiary();
    if (!current || busy || sourceDay === null) return;
    const plan = currentPlan(current);
    const accepted = plan
      .filter((target) => target.status === 'copied')
      .map((target) => target.dayIndex);
    if (!accepted.length) return;

    busy = true;
    updatePreview();
    try {
      const result = await onCopy({
        source_day_index: sourceDay,
        target_day_indexes: accepted,
      });
      const context = { plan, days: current.days, language: getLanguage() };
      close();
      onCopied(result, context);
    } catch (error) {
      busy = false;
      const failure = /** @type {{ code?: string | null, detail?: Record<string, unknown> }} */ (error);
      const described = describeError(t, failure.code, failure.detail || {});
      showNotice(t('diary.copy.failed'), described.text);
      updatePreview();
    }
  }

  /** @param {string} heading @param {string} text */
  function showNotice(heading, text) {
    const box = noticeBox({ title: heading, text });
    box.setAttribute('tabindex', '-1');
    body.prepend(box);
    box.focus();
  }

  closeButton.addEventListener('click', () => close());
  dialog.addEventListener('cancel', () => close());

  return {
    /**
     * @param {{ sourceDay?: number | null }} [options] A heading button passes
     *   the day it belongs to; without it the day in view is used when it has
     *   entries, and otherwise the source stays open for choosing.
     */
    open({ sourceDay: requested = null } = {}) {
      const current = getDiary();
      if (!current || current.study.submitted_at) return;
      const copyable = copyableDays(current);
      const start = requested != null ? requested : Number(getCurrentDay());
      sourceDay = copyable.includes(start) ? start : null;
      editingSource = sourceDay === null;
      render();
      if (!dialog.open) dialog.showModal();
    },

    close,

    destroy() {
      close();
      dialog.remove();
    },
  };
}
