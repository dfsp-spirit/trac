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
import { documentTitle, forWhomLabel } from '../domain/displayName.js';
import { offersLanguageChoice, studyLanguageOptions } from '../domain/language.js';
import { canSkipDiary } from '../domain/skip.js';
import { createDrawer } from './drawer.js';
import { restrictLanguageOptions } from './i18n-dom.js';
import { createLegalLinks } from './legalLinks.js';
import { createSkipDialog } from './skipDialog.js';

/**
 * @param {{
 *   shell: {
 *     root: HTMLElement,
 *     menu: HTMLDialogElement | null,
 *     menuOpen: HTMLElement | null,
 *     menuClose: HTMLElement | null,
 *     menuSkip: HTMLElement | null,
 *     menuSkipItem: HTMLElement | null,
 *     menuCopy: HTMLElement | null,
 *     menuCopyItem: HTMLElement | null,
 *     menuReview: HTMLElement | null,
 *     menuReviewItem: HTMLElement | null,
 *     menuPagesBlock: HTMLElement | null,
 *     menuPages: HTMLElement | null,
 *     footer: HTMLElement | null,
 *     footerLinks: HTMLElement | null,
 *     languageSelect: HTMLSelectElement | null,
 *     menuLanguageBlock: HTMLElement | null,
 *     forWhom: HTMLElement | null,
 *   },
 *   t: (key: string, params?: Record<string, string | number>) => string,
 *   getLanguage: () => string,
 *   onLanguageChange: (language: string) => void,
 *   onSkip: (body: { reason_code?: string, reason_note?: string }) => Promise<void> | void,
 *   onCopy: () => void,
 *   onReview: () => void,
 * }} deps
 */
export function createShellChrome({
  shell,
  t,
  getLanguage,
  onLanguageChange,
  onSkip,
  onCopy,
  onReview,
}) {
  // The drawer is a modal dialog, not a popover (ui/drawer.js): the popover
  // attribute is unknown below iOS 17 / Firefox 125, and where it is unknown the
  // drawer cannot be hidden at all.
  const drawer = shell.menu
    ? createDrawer({
        element: shell.menu,
        openButton: shell.menuOpen,
        closeButton: shell.menuClose,
      })
    : null;
  const closeMenu = () => drawer?.close();

  const legal = createLegalLinks({
    footer: shell.footer,
    footerList: shell.footerLinks,
    menuBlock: shell.menuPagesBlock,
    menuList: shell.menuPages,
    closeMenu,
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
    closeMenu();
    skipDialog.open();
  };
  shell.menuSkip?.addEventListener('click', onSkipClick);

  // Copying a day is a diary action: the entry is only there while the diary is
  // the current stage (apply() sets that).
  const onCopyClick = () => {
    closeMenu();
    onCopy();
  };
  shell.menuCopy?.addEventListener('click', onCopyClick);

  const onReviewClick = () => {
    closeMenu();
    onReview();
  };
  shell.menuReview?.addEventListener('click', onReviewClick);

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

  /**
   * Whose diary this is, in the topbar and in the document title. Runs with
   * every session (the name is per participant, not per stage) and again after
   * a language switch, because the label around it is translated.
   */
  function renderForWhom() {
    const label = forWhomLabel(session, t);
    if (shell.forWhom) {
      shell.forWhom.textContent = label;
      shell.forWhom.hidden = !label;
    }
    document.title = documentTitle(session, t);
  }

  return {
    /**
     * The study config is in: offer its languages and render its pages.
     * @param {any} studySession
     */
    apply(studySession) {
      session = studySession;
      renderForWhom();
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
      const inDiary = session?.stage === 'diary';
      if (shell.menuCopyItem) shell.menuCopyItem.hidden = !inDiary;
      if (shell.menuReviewItem) shell.menuReviewItem.hidden = !inDiary;
    },

    /**
     * The language in use changed: the select follows it and so do the page
     * labels.
     * @param {string} language
     */
    syncLanguage(language) {
      if (select) select.value = language;
      renderForWhom();
      legal.render(session);
    },

    closeMenu,

    destroy() {
      select?.removeEventListener('change', onSelectChange);
      shell.menuSkip?.removeEventListener('click', onSkipClick);
      shell.menuCopy?.removeEventListener('click', onCopyClick);
      shell.menuReview?.removeEventListener('click', onReviewClick);
      drawer?.destroy();
      skipDialog.destroy();
      legal.destroy();
    },
  };
}
