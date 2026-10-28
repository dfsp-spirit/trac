// @ts-check
/**
 * The consent stage (D37, D38).
 *
 * The study's own consent text, rendered as Markdown, and one decision. Consent
 * is a one-way latch: once given, this page is never shown again, and there is no
 * "change my mind" here - withdrawal happens through the research team, outside
 * this app.
 *
 * The page frame (eyebrow, heading, measure) belongs to ui/page.js (D40); this
 * view only supplies content. The server decides what happens next; this view
 * only reports the answer.
 */
import { el, button } from '../dom.js';
import { renderPage, prose } from '../page.js';
import { notice } from '../notice.js';

/**
 * @param {HTMLElement} host
 * @param {{
 *   session: any,
 *   t: (key: string, params?: Record<string, string | number>) => string,
 *   onDecide: (given: boolean) => Promise<void>,
 * }} view
 */
export function renderConsent(host, { session, t, onDecide }) {
  const failureSlot = el('div');
  const agree = button('primary', t('diary.stage.consentAgree'), () => void decide(true));
  const decline = button('secondary', t('diary.stage.consentDecline'), () => void decide(false));

  renderPage(host, {
    eyebrow: session.study_name,
    title: t('diary.stage.consentTitle'),
    lead: t('diary.stage.consentLead'),
    body: [prose(session.study_text_consent), failureSlot],
    actions: [agree, decline],
  });

  /** @param {boolean} given */
  async function decide(given) {
    agree.disabled = true;
    decline.disabled = true;
    failureSlot.replaceChildren();
    try {
      await onDecide(given);
    } catch {
      failureSlot.append(
        notice({
          title: t('diary.stage.failedTitle'),
          text: t('diary.stage.failedText'),
        })
      );
      agree.disabled = false;
      decline.disabled = false;
    }
  }
}
