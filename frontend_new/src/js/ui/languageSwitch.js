// @ts-check
/**
 * Switching the UI language, everywhere it has to switch (D34, D35, D40).
 *
 * One action - the participant picks a language - has six consequences: a new
 * translator, `<html lang>`, the static DOM, the store, the menu with its legal
 * links, and the page or diary behind them. Leaving the last one to a re-render
 * of the *cached* payload was wrong in the way D40 was written about: the study's
 * own texts arrive with the session and the day and activity names with the
 * diary, so both stayed in the language they were fetched in - German chrome
 * around English study text.
 *
 * It lives in a module rather than in the composition root because that is where
 * the sequence grew past the point main.js could carry it (D33 rule 7). The two
 * functions it needs from the data layer arrive as dependencies, so this module
 * still imports only `domain` and its own layer.
 */
import { followStudyLanguage } from '../domain/language.js';
import { ROUTE_DIARY } from '../domain/router.js';
import { applyTranslations } from './i18n-dom.js';

/** @typedef {{
 *   t: (key: string, params?: Record<string, string | number>) => string,
 *   tCount: (key: string, count: number) => string,
 *   has: (key: string) => boolean,
 * }} Translator */

/**
 * @param {{
 *   config: { supportedLanguages: readonly string[], defaultLanguage: string },
 *   store: { set: (patch: object) => void, get: () => any },
 *   chrome: { syncLanguage: (language: string) => void },
 *   stageMachine: { currentRoute: () => string | null, refresh: () => Promise<void> },
 *   loadMessages: (language: string) => Promise<{ messages: any, language: string }>,
 *   createTranslator: (messages: any) => Translator,
 *   setTranslator: (translator: Translator) => void,
 *   setDocumentLanguage: (language: string) => void,
 *   loadDiary?: () => Promise<void>,
 * }} deps
 */
export function createLanguageSwitch({
  config,
  store,
  chrome,
  stageMachine,
  loadMessages,
  createTranslator,
  setTranslator,
  setDocumentLanguage,
  loadDiary,
}) {
  /**
   * @param {string} next
   */
  async function setLanguage(next) {
    if (!config.supportedLanguages.includes(next)) return;
    const loaded = await loadMessages(next);
    const translator = createTranslator(loaded.messages);
    setTranslator(translator);

    setDocumentLanguage(loaded.language);
    applyTranslations(document, translator);
    store.set({ language: loaded.language });
    chrome.syncLanguage(loaded.language);

    // During boot nothing is on screen yet, and `show()` renders the payload it
    // has just fetched in this language.
    if (!stageMachine.currentRoute()) return;
    await stageMachine.refresh();
    // The diary keeps its own data: day and catalogue names only follow a reload.
    if (stageMachine.currentRoute() === ROUTE_DIARY) await loadDiary?.();
  }

  return {
    setLanguage,

    /**
     * Follow the study's language unless the URL named one (D40).
     *
     * @param {any} session
     * @param {string | null | undefined} explicit The `?lang` value, if any.
     */
    async adoptStudyLanguage(session, explicit) {
      const next = followStudyLanguage({
        selected: session?.selected_language,
        explicit,
        current: store.get().language,
        supported: config.supportedLanguages,
      });
      if (next) await setLanguage(next);
    },
  };
}
