// @ts-check
/**
 * The shell contract: every element main.js needs, looked up in one place.
 *
 * Keeping the lookups here means the wiring reads as wiring - a list of handles
 * and what is connected to them - and a renamed id fails in one obvious file.
 * Anything optional is nullable; the required slots throw, because a missing
 * one is a broken page, not a degraded one.
 */

/**
 * @param {HTMLElement} root
 */
export function readShell(root) {
  /** @param {string} selector @returns {HTMLElement} */
  const must = (selector) => {
    const node = root.querySelector(selector);
    if (!(node instanceof HTMLElement)) throw new Error(`Missing element ${selector}`);
    return node;
  };

  /** @param {string} selector @returns {HTMLElement | null} */
  const maybe = (selector) => {
    const node = root.querySelector(selector);
    return node instanceof HTMLElement ? node : null;
  };

  return {
    root,
    topbar: must('#topbar'),
    daysHost: must('#days'),
    stageHost: must('#stage-host'),
    shell: must('.t-shell'),
    dayNav: must('.t-daynav'),
    noticesHost: must('#timeline-notices'),
    railList: must('#rail-list'),
    progressNote: must('#progress-note'),
    fab: must('#fab'),
    submitBtn: must('#submit-btn'),
    toastRegion: must('#toast-region'),
    sectionHost: maybe('#panel-host'),
    dialogHost: /** @type {HTMLDialogElement | null} */ (maybe('#dialog-host')),
    template: /** @type {HTMLTemplateElement | null} */ (maybe('#activity-panel-tpl')),
    languageSelect: /** @type {HTMLSelectElement | null} */ (maybe('#language-select')),
    menuLanguageBlock: maybe('#menu-language-block'),
    menu: maybe('#menu'),
    menuShortcuts: maybe('#menu-shortcuts'),
    menuPagesBlock: maybe('#menu-pages-block'),
    menuPages: maybe('#menu-pages'),
    menuSkip: maybe('#menu-skip'),
    menuSkipItem: maybe('#menu-skip-item'),
    footer: maybe('#footer'),
    footerLinks: maybe('#footer-links'),
    nav: {
      prev: /** @type {HTMLAnchorElement | null} */ (maybe('#day-prev')),
      next: /** @type {HTMLAnchorElement | null} */ (maybe('#day-next')),
      label: maybe('#day-label'),
      meta: maybe('#day-meta'),
    },
  };
}
