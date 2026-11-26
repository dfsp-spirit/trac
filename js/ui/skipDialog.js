// @ts-check
/**
 * The skip-the-diary dialog (D41).
 *
 * One dialog, one irreversible action. It is deliberately *not* a two-step flow
 * like the submit review: somebody who wants out should not have to confirm
 * twice. Instead the copy carries the weight - what closes, what is kept, who
 * sees it, and (when the study requires a diary before its questionnaires) that
 * those tasks stay closed.
 *
 * The reason is optional. Requiring it would burden exactly the participants who
 * are already unhappy, and a missing reason is itself a signal.
 */
import { SKIP_REASON_CODES, skipConsequences } from '../domain/skip.js';
import { describeError } from './messages.js';

/** @typedef {(key: string, params?: Record<string, string | number>) => string} Translator */

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
 * @param {{
 *   root: HTMLElement,
 *   t: Translator,
 *   onSkip: (body: { reason_code?: string, reason_note?: string }) => Promise<void>,
 *   getSession: () => any,
 * }} deps
 */
export function createSkipDialog({ root, t, onSkip, getSession }) {
  const dialog = el('dialog', 't-modal t-modal--centred');
  dialog.id = 'skip-dialog';

  const head = el('div', 't-modal__head');
  const title = el('h2');
  title.id = 'skip-title';
  const closeButton = el('button', 't-icon-btn');
  closeButton.type = 'button';
  closeButton.setAttribute('data-i18n-aria-label', 'diary.shell.close');
  closeButton.append(icon('M6 6l12 12M18 6L6 18'));
  head.append(title, closeButton);

  const body = el('div', 't-modal__body');
  const foot = el('div', 't-modal__foot');
  dialog.append(head, body, foot);
  dialog.setAttribute('aria-labelledby', title.id);
  root.append(dialog);

  let busy = false;

  /** @param {string} path @returns {SVGSVGElement} */
  function icon(path) {
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('class', 't-icon');
    svg.setAttribute('viewBox', '0 0 24 24');
    svg.setAttribute('aria-hidden', 'true');
    const shape = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    shape.setAttribute('d', path);
    svg.append(shape);
    return svg;
  }

  function render() {
    const session = getSession();
    const consequences = skipConsequences(session);

    title.textContent = t('diary.skip.title');

    const prose = el('div', 't-prose');
    prose.append(el('p', null, t('diary.skip.closes')));
    prose.append(el('p', null, t('diary.skip.kept')));
    prose.append(el('p', null, t('diary.skip.visible')));
    if (consequences.tasksContinue) prose.append(el('p', null, t('diary.skip.tasksContinue')));
    if (consequences.tasksLocked) prose.append(el('p', null, t('diary.skip.tasksLocked')));

    const reasonField = el('div', 't-field');
    const reasonId = 'skip-reason';
    const reasonLabel = el('label', 't-label', t('diary.skip.reasonLabel'));
    reasonLabel.htmlFor = reasonId;
    const reason = el('select', 't-select t-select--text');
    reason.id = reasonId;
    const none = el('option', null, t('diary.skip.reasonNone'));
    none.value = '';
    reason.append(none);
    for (const entry of SKIP_REASON_CODES) {
      const option = el('option', null, t(entry.key));
      option.value = entry.id;
      reason.append(option);
    }
    reasonField.append(reasonLabel, reason);

    const noteField = el('div', 't-field');
    const noteId = 'skip-note';
    const noteLabel = el('label', 't-label', t('diary.skip.noteLabel'));
    noteLabel.htmlFor = noteId;
    const note = el('textarea', 't-input');
    note.id = noteId;
    note.rows = 3;
    note.maxLength = 500;
    noteField.append(noteLabel, note);

    // The note only makes sense with "another reason" - or with nothing picked.
    const syncNote = () => {
      noteField.hidden = reason.value !== '' && reason.value !== 'other';
    };
    reason.addEventListener('change', syncNote);
    syncNote();

    body.replaceChildren(prose, reasonField, noteField);

    const ok = el('button', 't-btn t-btn--primary t-btn--block');
    ok.type = 'button';
    ok.textContent = t('diary.skip.ok');
    ok.addEventListener('click', () => void send({ ok, reason, note }));

    const cancel = el('button', 't-btn t-btn--secondary t-btn--block');
    cancel.type = 'button';
    cancel.textContent = t('diary.skip.cancel');
    cancel.addEventListener('click', () => close());

    foot.replaceChildren(ok, cancel);
    // Default focus is the way out, not the irreversible action.
    cancel.focus();
  }

  /**
   * @param {{ ok: HTMLButtonElement, reason: HTMLSelectElement, note: HTMLTextAreaElement }} controls
   */
  async function send({ ok, reason, note }) {
    if (busy) return;
    busy = true;
    ok.disabled = true;
    ok.textContent = t('diary.skip.sending');

    /** @type {{ reason_code?: string, reason_note?: string }} */
    const payload = {};
    if (reason.value) payload.reason_code = reason.value;
    const text = note.value.trim();
    if (text) payload.reason_note = text;

    try {
      await onSkip(payload);
      close();
    } catch (error) {
      busy = false;
      ok.disabled = false;
      ok.textContent = t('diary.skip.ok');
      const code = /** @type {{ code?: string | null }} */ (error).code;
      const described = describeError(t, code);
      showNotice(described.title || t('diary.skip.failed'), described.text);
    }
  }

  /** @param {string} heading @param {string} [text] */
  function showNotice(heading, text) {
    const notice = el('div', 't-notice t-notice--attention');
    notice.setAttribute('role', 'alert');
    notice.setAttribute('tabindex', '-1');
    const inner = el('div', 't-notice__body');
    inner.append(el('p', 't-notice__title', heading));
    if (text) inner.append(el('p', null, text));
    notice.append(inner);
    body.prepend(notice);
    notice.focus();
  }

  function close() {
    if (dialog.open) dialog.close();
    busy = false;
  }

  closeButton.addEventListener('click', () => close());
  dialog.addEventListener('cancel', () => close());

  return {
    open() {
      render();
      if (!dialog.open) dialog.showModal();
      const secondary = foot.querySelector('.t-btn--secondary');
      if (secondary instanceof HTMLElement) secondary.focus();
    },
    close,
    destroy() {
      dialog.remove();
    },
  };
}
