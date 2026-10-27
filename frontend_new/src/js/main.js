// @ts-check
/**
 * Composition root. The only file that knows about every layer: it reads the
 * deployment config, loads the locale, hands the translator to the UI, and
 * hosts the activity panel in the desktop column or the mobile dialog.
 *
 * It owns no application state. Domain rules live in js/domain, persistence in
 * js/data, and components in js/ui; when they exist they are mounted from here
 * with explicit inputs (D36, seam C).
 */
import { config } from './config.js';
import { createTranslator, loadLocale } from './data/i18n.js';
import { applyTranslations } from './ui/i18n-dom.js';

/**
 * @typedef {Object} MountInputs
 * @property {HTMLElement} root
 * @property {URLSearchParams} params
 */

/**
 * @param {MountInputs} inputs
 * @returns {{ destroy: () => void }}
 */
export function mount({ root, params }) {
  const languageFromUrl = params.get('lang');
  const initialLanguage =
    languageFromUrl && config.supportedLanguages.includes(languageFromUrl)
      ? languageFromUrl
      : config.defaultLanguage;

  let translator = createTranslator({});

  const t = (/** @type {string} */ key, /** @type {Record<string, string | number>} */ paramsForText) =>
    translator.t(key, paramsForText);
  const tCount = (/** @type {string} */ key, /** @type {number} */ count) => translator.tCount(key, count);

  // One breakpoint, the same 1200px as the media queries in layout.css (D12).
  const wide = window.matchMedia('(min-width: 1200px)');
  const topbar = /** @type {HTMLElement | null} */ (root.querySelector('#topbar'));
  const sectionHost = root.querySelector('#panel-host');
  const dialogHost = /** @type {HTMLDialogElement | null} */ (root.querySelector('#dialog-host'));
  const template = /** @type {HTMLTemplateElement | null} */ (root.querySelector('#activity-panel-tpl'));
  const fab = root.querySelector('#fab');
  const languageSelect = /** @type {HTMLSelectElement | null} */ (root.querySelector('#language-select'));

  /**
   * The same markup is hosted twice: a sticky column on desktop, a modal dialog
   * on phones (D29). Only one host ever holds content.
   *
   * @returns {Element | null}
   */
  function hostPanel() {
    const isWide = wide.matches;
    const target = isWide ? sectionHost : dialogHost;
    const other = isWide ? dialogHost : sectionHost;
    if (!target || !other || !template) return null;

    other.replaceChildren();
    if (isWide && dialogHost?.open) dialogHost.close();

    if (!target.firstElementChild) {
      target.append(template.content.cloneNode(true));
      applyTranslations(target, translator);

      const title = /** @type {HTMLElement | null} */ (target.querySelector('[data-slot="title"]'));
      if (title) {
        if (!title.id) title.id = `${target.id}-title`;
        // A dialog needs an accessible name; a section is named by its heading.
        if (target === dialogHost) target.setAttribute('aria-labelledby', title.id);
      }

      target.querySelector('[data-slot="close"]')?.addEventListener('click', () => {
        if (dialogHost?.open) dialogHost.close();
      });
    }
    return target;
  }

  function openPanel() {
    const panel = hostPanel();
    if (!panel) return;
    if (dialogHost && !wide.matches) {
      if (!dialogHost.open) dialogHost.showModal();
    }
    /** @type {HTMLElement | null} */
    const search = panel.querySelector('input[type="search"]');
    search?.focus();
  }

  /** @param {string} language */
  async function setLanguage(language) {
    const messages = await loadLocale(language);
    translator = createTranslator(messages);
    document.documentElement.lang = language;
    applyTranslations(document, translator);
    if (languageSelect) languageSelect.value = language;
  }

  const onFabClick = () => openPanel();
  const onLanguageChange = () => {
    const next = languageSelect?.value;
    if (next && config.supportedLanguages.includes(next)) {
      void setLanguage(next);
    }
  };
  const onBreakpointChange = () => {
    hostPanel();
  };

  fab?.addEventListener('click', onFabClick);
  languageSelect?.addEventListener('change', onLanguageChange);
  wide.addEventListener('change', onBreakpointChange);

  let observer = null;
  if (topbar && typeof ResizeObserver !== 'undefined') {
    observer = new ResizeObserver(() => {
      root.style.setProperty('--topbar-h', `${topbar.offsetHeight}px`);
    });
    observer.observe(topbar);
  }

  hostPanel();
  void setLanguage(initialLanguage).catch((error) => {
    // The markup carries English fallbacks, so a failed locale fetch degrades
    // to a usable page rather than a blank one.
    console.error('[i18n] falling back to the markup text:', error);
  });

  return {
    destroy() {
      fab?.removeEventListener('click', onFabClick);
      languageSelect?.removeEventListener('change', onLanguageChange);
      wide.removeEventListener('change', onBreakpointChange);
      observer?.disconnect();
    },
  };
}

const root = /** @type {HTMLElement | null} */ (document.querySelector('.t-app'));
if (root) {
  mount({ root, params: new URLSearchParams(window.location.search) });
}
