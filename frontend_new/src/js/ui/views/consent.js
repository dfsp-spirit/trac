// @ts-check
/**
 * The consent stage (D37, D38).
 *
 * The study's own consent text, rendered as Markdown, and one decision. Consent
 * is a one-way latch: once given, this page is never shown again, and there is no
 * "change my mind" here - withdrawal happens through the research team, outside
 * this app.
 *
 * The server decides what happens next; this view only reports the answer.
 */
import { el, button } from '../dom.js';
import { renderMarkdown } from '../../domain/markdown.js';

/**
 * @param {HTMLElement} host
 * @param {{
 *   session: any,
 *   t: (key: string, params?: Record<string, string | number>) => string,
 *   onDecide: (given: boolean) => Promise<void>,
 * }} view
 */
export function renderConsent(host, { session, t, onDecide }) {
  const page = el('div', 't-stage__page');

  const head = el('div', 't-page-head');
  head.append(el('h1', null, session.study_name || t('diary.stage.consentTitle')));
  head.append(el('p', null, t('diary.stage.consentLead')));
  page.append(head);

  const prose = el('div', 't-prose');
  prose.innerHTML = renderMarkdown(session.study_text_consent);
  page.append(prose);

  const notice = el('div');
  page.append(notice);

  const actions = el('div', 't-stage__actions');
  const agree = button('primary', t('diary.stage.consentAgree'), () => void decide(true));
  const decline = button('secondary', t('diary.stage.consentDecline'), () => void decide(false));
  actions.append(agree, decline);
  page.append(actions);

  host.replaceChildren(page);

  /** @param {boolean} given */
  async function decide(given) {
    agree.disabled = true;
    decline.disabled = true;
    notice.replaceChildren();
    try {
      await onDecide(given);
    } catch (error) {
      const failure = el('div', 't-notice t-notice--attention');
      failure.setAttribute('role', 'alert');
      const body = el('div', 't-notice__body');
      body.append(el('p', 't-notice__title', t('diary.stage.failedTitle')));
      body.append(el('p', null, t('diary.stage.failedText')));
      failure.append(body);
      notice.replaceChildren(failure);
      agree.disabled = false;
      decline.disabled = false;
    }
  }
}
