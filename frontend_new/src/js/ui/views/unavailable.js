// @ts-check
/**
 * The `unavailable` stage (D37): the study is paused, closed, or outside its
 * collection window. Nothing to do but say so, and say whether coming back helps.
 */
import { el } from '../dom.js';

/**
 * @param {HTMLElement} host
 * @param {{
 *   session: any,
 *   t: (key: string, params?: Record<string, string | number>) => string,
 * }} view
 */
export function renderUnavailable(host, { session, t }) {
  const page = el('div', 't-stage__page');

  const head = el('div', 't-page-head');
  head.append(el('h1', null, session.study_name || t('diary.stage.unavailableTitle')));
  page.append(head);

  const notice = el('div', 't-notice t-notice--attention');
  notice.setAttribute('role', 'status');
  const body = el('div', 't-notice__body');
  body.append(el('p', 't-notice__title', t('diary.stage.unavailableTitle')));
  body.append(el('p', null, t('diary.stage.unavailableText')));
  notice.append(body);
  page.append(notice);

  host.replaceChildren(page);
}
