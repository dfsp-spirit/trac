// @ts-check
/**
 * The `done` stage (D37): thank-you, with the study's own closing text.
 *
 * Which text depends on how the participant got here: `noconsent` when they
 * declined (D38), `skipped` when they closed the diary without filling it (D41),
 * `completed` otherwise. There is nothing to edit - the diary is closed, and the
 * server says so.
 *
 * The one action is the way out: when the invitation link carried a
 * `return_url`, the participant arrived from another system (a panel provider,
 * an employer's portal) and has to be handed back to it. A declined participant
 * gets no such link - sending someone who said no on to a "finished" page is a
 * statement the study has not earned.
 */
import { el } from '../dom.js';
import { renderPage, prose } from '../page.js';

/**
 * @param {HTMLElement} host
 * @param {{
 *   session: any,
 *   t: (key: string, params?: Record<string, string | number>) => string,
 *   returnUrl?: string | null,
 * }} view
 */
export function renderThanks(host, { session, t, returnUrl = null }) {
  const declined = session.done_reason === 'noconsent';
  const skipped = session.done_reason === 'skipped';
  let text = session.study_text_end_completed;
  if (declined) text = session.study_text_end_noconsent;
  else if (skipped) text = session.study_text_end_skipped || session.study_text_end_completed;

  const body = [];
  if (text) {
    body.push(prose(text));
  } else {
    const fallback = el('p', null, t('diary.stage.thanksFallback'));
    body.push(fallback);
  }

  const actions = [];
  if (returnUrl && !declined) {
    const back = el('a', 't-btn t-btn--primary t-btn--block', t('diary.stage.taskContinue'));
    back.href = returnUrl;
    actions.push(back);
  }

  renderPage(host, {
    eyebrow: session.study_name,
    title: declined ? t('diary.stage.declinedTitle') : t('diary.stage.thanksTitle'),
    body,
    actions,
    mark: [declined ? 'M6 6l12 12M18 6L6 18' : 'M5 13l4 4L19 7'],
  });
}
