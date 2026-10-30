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
import { studyLanguageOptions } from '../domain/language.js';
import { restrictLanguageOptions } from './i18n-dom.js';
import { createLegalLinks } from './legalLinks.js';

/**
 * @param {{
 *   shell: {
 *     menu: HTMLElement | null,
 *     menuPagesBlock: HTMLElement | null,
 *     menuPages: HTMLElement | null,
 *     footer: HTMLElement | null,
 *     footerLinks: HTMLElement | null,
 *     languageSelect: HTMLSelectElement | null,
 *   },
 *   t: (key: string, params?: Record<string, string | number>) => string,
 *   getLanguage: () => string,
 *   onLanguageChange: (language: string) => void,
 * }} deps
 */
export function createShellChrome({ shell, t, getLanguage, onLanguageChange }) {
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
      restrictLanguageOptions(
        select,
        studyLanguageOptions(
          studySession?.supported_languages ?? [],
          config.supportedLanguages
        )
      );
      legal.render(session);
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
      legal.destroy();
    },
  };
}
