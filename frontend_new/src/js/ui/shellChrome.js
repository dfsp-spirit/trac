// @ts-check
/**
 * The parts of the shell that only mean anything once the study is known: which
 * languages the menu may offer (D40) and which pages it links to (imprint, data
 * protection, and the study's own `footer_links`).
 *
 * Both answers arrive in the same study-config payload, and both have to be
 * redone whenever the participant switches language. Keeping them in one
 * component is also what keeps the composition root under its size cap.
 */
import { config } from '../config.js';
import { offersLanguageChoice, studyLanguageOptions } from '../domain/language.js';
import { canSkipDiary } from '../domain/skip.js';
import { restrictLanguageOptions } from './i18n-dom.js';
import { createLegalLinks } from './legalLinks.js';
import { createSkipDialog } from './skipDialog.js';

/**
 * @param {{
 *   shell: {
 *     root: HTMLElement,
 *     menu: HTMLElement | null,
 *     menuSkip: HTMLElement | null,
 *     menuSkipItem: HTMLElement | null,
 *     menuPagesBlock: HTMLElement | null,
 *     menuPages: HTMLElement | null,
 *     footer: HTMLElement | null,
 *     footerLinks: HTMLElement | null,
 *     languageSelect: HTMLSelectElement | null,
 *     menuLanguageBlock: HTMLElement | null,
 *   },
 *   t: (key: string, params?: Record<string, string | number>) => string,
 *   getLanguage: () => string,
 *   onLanguageChange: (language: string) => void,
 *   onSkip: (body: { reason_code?: string, reason_note?: string }) => Promise<void> | void,
 * }} deps
 */
export function createShellChrome({
  shell,
  t,
  getLanguage,
  onLanguageChange,
  onSkip,
}) {
  const legal = createLegalLinks({
    footer: shell.footer,
    footerList: shell.footerLinks,
    menuBlock: shell.menuPagesBlock,
    menuList: shell.menuPages,
    menu: shell.menu,
    t,
    getLanguage,
  });
  legal.connect();

  // Skipping ends the diary part of the study: the entry appears only when the
  // study asks for it, and the dialog explains what it does to the participant's
  // data and to any remaining tasks (D41).
  const skipDialog = createSkipDialog({
    root: shell.root,
    t,
    onSkip: async (body) => {
      await onSkip(body);
    },
    getSession: () => session,
  });
  const onSkipClick = () => {
    if (shell.menu && shell.menu.matches(':popover-open')) shell.menu.hidePopover();
    skipDialog.open();
  };
  shell.menuSkip?.addEventListener('click', onSkipClick);

  const select = shell.languageSelect;
  // The select lives in this menu, and picking a language is what makes the
  // labels below it (and the footer) change - so it is wired here, not in the
  // composition root.
  const onSelectChange = () => {
    const next = select?.value;
    if (next) onLanguageChange(next);
  };
  select?.addEventListener('change', onSelectChange);

  /** @type {any} */
  let session = null;

  return {
    /**
     * The study config is in: offer its languages and render its pages.
     * @param {any} studySession
     */
    apply(studySession) {
      session = studySession;
      const languages = studyLanguageOptions(
        studySession?.supported_languages ?? [],
        config.supportedLanguages
      );
      restrictLanguageOptions(select, languages);
      // A single language is not a choice: hide the entry (and its separator)
      // instead of showing a select with one option.
      if (shell.menuLanguageBlock) {
        shell.menuLanguageBlock.hidden = !offersLanguageChoice(languages);
      }
      legal.render(session);
      if (shell.menuSkipItem) shell.menuSkipItem.hidden = !canSkipDiary(session);
    },

    /**
     * The language in use changed: the select follows it and so do the page
     * labels.
     * @param {string} language
     */
    syncLanguage(language) {
      if (select) select.value = language;
      legal.render(session);
    },

    destroy() {
      select?.removeEventListener('change', onSelectChange);
      shell.menuSkip?.removeEventListener('click', onSkipClick);
      skipDialog.destroy();
      legal.destroy();
    },
  };
}
