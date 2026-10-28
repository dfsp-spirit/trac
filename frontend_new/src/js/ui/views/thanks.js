// @ts-check
/**
 * The `done` stage (D37): thank-you, with the study's own closing text.
 *
 * Which text depends on how the participant got here: `noconsent` when they
 * declined (D38), `completed` otherwise. There is nothing to do on this page and
 * nothing to edit - the diary is locked, and the server says so.
 */
import { el } from '../dom.js';
import { renderPage, prose } from '../page.js';

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

  const body = [];
  if (text) {
    body.push(prose(text));
  } else {
    const fallback = el('p', null, t('diary.stage.thanksFallback'));
    body.push(fallback);
  }

  renderPage(host, {
    eyebrow: session.study_name,
    title: declined ? t('diary.stage.declinedTitle') : t('diary.stage.thanksTitle'),
    body,
    mark: [declined ? 'M6 6l12 12M18 6L6 18' : 'M5 13l4 4L19 7'],
  });
}
