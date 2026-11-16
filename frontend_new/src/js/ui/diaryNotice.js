// @ts-check
/**
 * The one line above the timeline that says what state the diary is in: closed
 * and read-only after submission, or - the moment the last day reaches its
 * requirement - ready to send, with the action right there.
 *
 * The second state exists because nothing else on the page changes at that
 * moment. On a phone the progress line is not shown at all, so without it the
 * only cue would be a button in the top bar changing colour.
 */

import { notice as noticeBox } from './notice.js';

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
 *   submitted: boolean,
 *   ready: boolean,
 *   t: (key: string, params?: Record<string, string | number>) => string,
 *   onReview: () => void,
 * }} view
 */
export function renderDiaryNotice(host, { submitted, ready, t, onReview }) {
  if (!submitted && ready) {
    const action = el('button', 't-btn t-btn--primary t-btn--block', t('diary.review.submit'));
    action.type = 'button';
    action.addEventListener('click', onReview);
    host.replaceChildren(
      noticeBox({
        title: t('diary.notice.readyTitle'),
        text: t('diary.notice.readyText'),
        tone: 'attention',
        role: 'status',
        extra: [action],
      })
    );
    return;
  }

  if (!submitted) {
    host.replaceChildren();
    return;
  }

  const notice = el('div', 't-notice t-notice--readonly');
  notice.setAttribute('role', 'note');

  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('class', 't-icon');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('aria-hidden', 'true');
  const shape = document.createElementNS('http://www.w3.org/2000/svg', 'path');
  shape.setAttribute('d', 'M5 11h14v9H5zM8 11V8a4 4 0 0 1 8 0v3');
  svg.append(shape);
  notice.append(svg);

  const inner = el('div', 't-notice__body');
  inner.append(el('p', 't-notice__title', t('diary.notice.submittedTitle')));
  inner.append(el('p', null, t('diary.notice.submittedText')));
  notice.append(inner);

  host.replaceChildren(notice);
}
