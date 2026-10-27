// @ts-check
/**
 * The `done` stage (D37): thank-you, with the study's own closing text.
 *
 * Which text depends on how the participant got here: `noconsent` when they
 * declined (D38), `completed` otherwise. There is nothing to do on this page and
 * nothing to edit - the diary is locked, and the server says so.
 */
import { el, icon } from '../dom.js';
import { renderMarkdown } from '../../domain/markdown.js';

/**
 * @param {HTMLElement} host
 * @param {{
 *   session: any,
 *   t: (key: string, params?: Record<string, string | number>) => string,
 * }} view
 */
export function renderThanks(host, { session, t }) {
  const declined = session.done_reason === 'noconsent';
  const text = declined ? session.study_text_end_noconsent : session.study_text_end_completed;

  const page = el('div', 't-stage__page');
  const confirm = el('div', 't-confirm');

  const mark = el('div', 't-confirm__mark');
  mark.append(icon([declined ? 'M6 6l12 12M18 6L6 18' : 'M5 13l4 4L19 7']));
  confirm.append(mark);

  confirm.append(
    el('h2', null, declined ? t('diary.stage.declinedTitle') : t('diary.stage.thanksTitle'))
  );

  const prose = el('div', 't-prose');
  if (text) prose.innerHTML = renderMarkdown(text);
  else prose.append(el('p', null, t('diary.stage.thanksFallback')));
  confirm.append(prose);

  page.append(confirm);
  host.replaceChildren(page);
}
