// @ts-check
/**
 * The instructions stage (D37): the study's own text, then one confirmation.
 *
 * No screenshots, no carousel, no "next/next/next" - the app-specific help page
 * was dropped on purpose (Q9), and what is left is the researchers' text plus a
 * single button that says the participant has read it.
 */
import { el, button } from '../dom.js';
import { renderMarkdown } from '../../domain/markdown.js';

/**
 * @param {HTMLElement} host
 * @param {{
 *   session: any,
 *   t: (key: string, params?: Record<string, string | number>) => string,
 *   onComplete: () => Promise<void>,
 * }} view
 */
export function renderInstructions(host, { session, t, onComplete }) {
  const page = el('div', 't-stage__page');

  const head = el('div', 't-page-head');
  head.append(
    el('h1', null, session.study_text_instructions_title || t('diary.stage.instructionsTitle'))
  );
  page.append(head);

  const prose = el('div', 't-prose');
  prose.innerHTML = renderMarkdown(session.study_text_instructions);
  page.append(prose);

  const notice = el('div');
  page.append(notice);

  const actions = el('div', 't-stage__actions');
  const done = button('primary', t('diary.stage.instructionsDone'), () => void complete());
  actions.append(done);
  page.append(actions);

  host.replaceChildren(page);

  async function complete() {
    done.disabled = true;
    notice.replaceChildren();
    try {
      await onComplete();
    } catch {
      const failure = el('div', 't-notice t-notice--attention');
      failure.setAttribute('role', 'alert');
      const body = el('div', 't-notice__body');
      body.append(el('p', 't-notice__title', t('diary.stage.failedTitle')));
      body.append(el('p', null, t('diary.stage.failedText')));
      failure.append(body);
      notice.replaceChildren(failure);
      done.disabled = false;
    }
  }
}
