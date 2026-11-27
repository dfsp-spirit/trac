// @ts-check
/**
 * The one-time offer to seed an empty proxy questionnaire from a sibling's
 * diary (decision 18).
 *
 * It lives in the diary's notice area, which is empty while nothing needs
 * attention - so the offer never competes with the "ready to submit" notice.
 * The rules are in `domain/templateCopy.js`; the server refuses a copy anyway
 * (non-empty target, no finished sibling, wrong study type), so a wrong guess
 * here costs a toast, never data.
 */
import { shouldOfferTemplateCopy } from '../domain/templateCopy.js';
import { el } from './dom.js';
import { notice } from './notice.js';

/**
 * @param {{
 *   host: HTMLElement,
 *   store: { get: () => any, subscribe: (fn: (state: any) => void) => () => void },
 *   api: { copyPreviousQuestionnaire: () => Promise<any> },
 *   t: (key: string, params?: Record<string, string | number>) => string,
 *   onCopied: () => void,
 *   signals?: { track: (name: string, props?: Record<string, any>) => void },
 * }} deps
 */
export function createTemplateCopyOffer({ host, store, api, t, onCopied, signals }) {
  /** @type {any} */
  let session = null;
  /** Subject the parent already answered for; the offer is shown once. */
  /** @type {string | null} */
  let handledSubject = null;
  let shown = false;

  function hide() {
    if (!shown) return;
    shown = false;
    host.replaceChildren();
  }

  function render() {
    const state = store.get();
    const { offer, subjectId } = shouldOfferTemplateCopy({
      session,
      state,
      handledSubject,
    });
    if (!offer || shown) return;
    shown = true;

    const copy = el('button', 't-btn t-btn--primary', t('diary.templateCopy.copy'));
    copy.type = 'button';
    copy.addEventListener('click', async () => {
      copy.disabled = true;
      try {
        const result = await api.copyPreviousQuestionnaire();
        signals?.track('diary.templateCopy', {
          accepted: true,
          copied: result?.copied ?? 0,
        });
        handledSubject = subjectId;
        hide();
        onCopied();
      } catch (error) {
        // The server refused (e.g. the sibling had no entries). Keep the offer
        // visible so the parent can still choose "start blank".
        signals?.track('diary.templateCopy', { accepted: true, failed: true });
        copy.disabled = false;
      }
    });

    const blank = el('button', 't-btn t-btn--secondary', t('diary.templateCopy.blank'));
    blank.type = 'button';
    blank.addEventListener('click', () => {
      signals?.track('diary.templateCopy', { accepted: false });
      handledSubject = subjectId;
      hide();
    });

    host.replaceChildren(
      notice({
        title: t('diary.templateCopy.title'),
        text: t('diary.templateCopy.text'),
        tone: 'attention',
        role: 'status',
        extra: [copy, blank],
      })
    );
  }

  const unsubscribe = store.subscribe(render);

  return {
    /** @param {any} next The study-config payload, on every reload. */
    sessionChanged(next) {
      session = next;
      render();
    },
    render,
    destroy() {
      unsubscribe();
      host.replaceChildren();
    },
  };
}

/**
 * Compose the offer from the pieces the composition root already has.
 *
 * A single entry point keeps `main.js` (which has a hard size cap) from growing
 * a wiring block, and keeps every dependency of the offer visible in one place.
 *
 * @param {HTMLElement} host
 * @param {any} store
 * @param {(key: string, params?: Record<string, string | number>) => string} t
 * @param {{ track: (name: string, props?: Record<string, any>) => void } | undefined} signals
 * @param {() => any} getApi
 * @param {() => any} getActions
 */
export function mountTemplateCopy(host, store, t, signals, getApi, getActions) {
  return createTemplateCopyOffer({
    host,
    store,
    t,
    signals,
    api: { copyPreviousQuestionnaire: () => getApi()?.copyPreviousQuestionnaire() },
    onCopied: () => void getActions()?.load(),
  });
}
