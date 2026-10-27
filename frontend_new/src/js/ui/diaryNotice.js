// @ts-check
/**
 * The one line above the timeline that says what state the diary is in.
 *
 * Today that is "submitted, and therefore read-only": the timeline stays
 * readable after submission, which is friendlier than sending the participant
 * away, but nothing in it can change any more.
 */

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
 *   t: (key: string, params?: Record<string, string | number>) => string,
 * }} view
 */
export function renderDiaryNotice(host, { submitted, t }) {
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
