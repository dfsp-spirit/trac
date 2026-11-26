// @ts-check
/**
 * The instructions stage (D37): the study's own text, then one confirmation.
 *
 * No screenshots, no carousel, no "next/next/next" - the app-specific help page
 * was dropped on purpose (Q9), and what is left is the researchers' text plus a
 * single button that says the participant has read it.
 */
import { el, button } from '../dom.js';
import { renderPage, prose } from '../page.js';
import { notice } from '../notice.js';

/**
 * @param {HTMLElement} host
 * @param {{
 *   session: any,
 *   t: (key: string, params?: Record<string, string | number>) => string,
 *   onComplete: () => Promise<void>,
 * }} view
 */
export function renderInstructions(host, { session, t, onComplete }) {
  const failureSlot = el('div');
  const done = button('primary', t('diary.stage.instructionsDone'), () => void complete());

  renderPage(host, {
    eyebrow: session.study_name,
    title: session.study_text_instructions_title || t('diary.stage.instructionsTitle'),
    body: [prose(session.study_text_instructions), failureSlot],
    actions: [done],
  });

  async function complete() {
    done.disabled = true;
    failureSlot.replaceChildren();
    try {
      await onComplete();
    } catch {
      failureSlot.append(
        notice({
          title: t('diary.stage.failedTitle'),
          text: t('diary.stage.failedText'),
        })
      );
      done.disabled = false;
    }
  }
}
