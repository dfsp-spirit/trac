// @ts-check
/**
 * Review and submit (D32).
 *
 * A centred modal with two deliberate steps: the week, then "this is final".
 * The modal does not replace the middle column - reviewing is a focused task,
 * and swapping the timeline out would add a third state to it for no gain.
 *
 * The component owns no application state. It is handed a diary, renders it,
 * and calls back: `onEdit` when a day should be opened on the timeline, and
 * `onSubmit` for the one irreversible action. Whether the diary may be
 * submitted is decided in domain/review.js, and confirmed by the server.
 */
import { formatClock } from '../domain/time.js';
import { review } from '../domain/review.js';
import { describeError } from './messages.js';
import { renderReviewList } from './reviewList.js';

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
 * @param {string} path SVG path data for a 24x24 stroke icon.
 * @returns {SVGSVGElement}
 */
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

/**
 * @param {{
 *   root: HTMLElement,
 *   t: Translator,
 *   onEdit: (dayIndex: number) => void,
 *   onSubmit: () => Promise<unknown>,
 * }} deps
 */
export function createReviewModal({ root, t, onEdit, onSubmit }) {
  const dialog = el('dialog', 't-modal t-review-modal');
  dialog.id = 'review-dialog';

  const head = el('div', 't-modal__head');
  const backButton = el('button', 't-icon-btn');
  backButton.type = 'button';
  backButton.hidden = true;
  // Translated by the document-wide pass, so a language switch reaches it too.
  backButton.setAttribute('data-i18n-aria-label', 'diary.review.back');
  backButton.append(icon('M15 6l-6 6 6 6'));

  const titles = el('div');
  const title = el('h2');
  title.id = 'review-title';
  const stepNote = el('span', 't-modal__step');
  titles.append(title, stepNote);

  const closeButton = el('button', 't-icon-btn');
  closeButton.type = 'button';
  closeButton.setAttribute('data-i18n-aria-label', 'diary.shell.close');
  closeButton.append(icon('M6 6l12 12M18 6L6 18'));
  head.append(backButton, titles, closeButton);

  const body = el('div', 't-modal__body');
  const noticeHost = el('div');
  const content = el('div');
  body.append(noticeHost, content);

  const foot = el('div', 't-modal__foot');
  dialog.append(head, body, foot);
  dialog.setAttribute('aria-labelledby', title.id);
  root.append(dialog);

  /** @type {import('../domain/review.js').Review | null} */
  let model = null;
  /** @type {import('../domain/diary.js').ApiDiary | null} */
  let diary = null;
  let busy = false;

  /**
   * @param {string} heading
   * @param {string} [text]
   */
  function showNotice(heading, text) {
    const notice = el('div', 't-notice t-notice--attention');
    notice.setAttribute('role', 'alert');
    notice.setAttribute('tabindex', '-1');
    const inner = el('div', 't-notice__body');
    inner.append(el('p', 't-notice__title', heading));
    if (text) inner.append(el('p', null, text));
    notice.append(inner);
    noticeHost.replaceChildren(notice);
    notice.focus();
  }

  function clearNotice() {
    noticeHost.replaceChildren();
  }

  function renderReview() {
    if (!model || !diary) return;
    backButton.hidden = true;
    title.textContent = t('diary.review.title');
    stepNote.textContent = t('diary.review.step', { current: 1, total: 2 });

    const dayStart = diary.study.day_start_minutes || 0;
    renderReviewList(content, {
      review: model,
      clock: (minutes) => formatClock(minutes, dayStart),
      onEdit: (dayIndex) => {
        close();
        onEdit(dayIndex);
      },
      t,
    });

    const submit = el('button', 't-btn t-btn--primary t-btn--block');
    submit.type = 'button';
    submit.textContent = t('diary.review.submit');
    submit.addEventListener('click', () => {
      if (!model) return;
      if (!model.canSubmit) {
        showNotice(
          t('diary.review.rejectedTitle'),
          t('diary.review.rejected', { days: model.incompleteLabels.join(', ') })
        );
        return;
      }
      renderConfirm();
    });

    const hint = el('p', 't-hint');
    hint.textContent = t('diary.review.hint');
    foot.replaceChildren(submit, hint);
    clearNotice();
  }

  function renderConfirm() {
    if (!model) return;
    backButton.hidden = false;
    title.textContent = t('diary.review.confirmTitle');
    stepNote.textContent = t('diary.review.step', { current: 2, total: 2 });

    const prose = el('div', 't-prose');
    prose.append(el('p', null, t('diary.review.confirmText', { total: model.totalDays })));
    prose.append(el('p', null, t('diary.review.confirmLocked')));
    content.replaceChildren(prose);

    const yes = el('button', 't-btn t-btn--primary t-btn--block');
    yes.type = 'button';
    yes.textContent = t('diary.review.confirmYes');
    yes.addEventListener('click', () => void send(yes));

    const no = el('button', 't-btn t-btn--secondary t-btn--block');
    no.type = 'button';
    no.textContent = t('diary.review.confirmNo');
    no.addEventListener('click', () => renderReview());

    foot.replaceChildren(yes, no);
    clearNotice();
    no.focus();
  }

  /** @param {HTMLButtonElement} button */
  async function send(button) {
    if (busy) return;
    busy = true;
    button.disabled = true;
    button.textContent = t('diary.review.sending');
    try {
      await onSubmit();
      close();
    } catch (error) {
      busy = false;
      const code = /** @type {{ code?: string | null }} */ (error).code;
      if (code === 'days.incomplete') {
        renderReview();
        showNotice(t('diary.review.rejectedTitle'), t('diary.review.rejectedServer'));
      } else {
        renderConfirm();
        const described = describeError(t, code);
        showNotice(described.title, described.text);
      }
    }
  }

  function close() {
    if (dialog.open) dialog.close();
    busy = false;
  }

  backButton.addEventListener('click', () => renderReview());
  closeButton.addEventListener('click', () => close());
  dialog.addEventListener('cancel', () => close());

  return {
    /**
     * @param {import('../domain/diary.js').ApiDiary} current
     * @param {string} language
     */
    open(current, language) {
      diary = current;
      model = review(current, language);
      renderReview();
      if (!dialog.open) dialog.showModal();
      const primary = foot.querySelector('.t-btn--primary');
      if (primary instanceof HTMLElement) primary.focus();
    },
    close,
    destroy() {
      dialog.remove();
    },
  };
}
