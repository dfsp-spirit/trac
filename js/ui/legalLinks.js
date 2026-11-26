// @ts-check
/**
 * The pages a participant may want to read: the deployment's imprint and data
 * protection, plus whatever the study itself links (`footer_links`, e.g. study
 * information and contact).
 *
 * Two hosts, one list. The menu carries all of them on every device; the footer
 * repeats only the deployment's legal pair, and only from 1200px up (layout.css),
 * because on a phone anything below a week-long timeline is a misclick target
 * rather than a service. Entries without a URL are dropped instead of rendered
 * dead (D28: an entry that does nothing is worse than no entry).
 */

/** @typedef {{ href: string, label: string, external: boolean }} LegalLink */

/**
 * @param {unknown} value
 * @returns {string} The URL, trimmed, or an empty string when there is none.
 */
function url(value) {
  return typeof value === 'string' ? value.trim() : '';
}

/**
 * True for a target another site serves. Anything relative stays ours, so it can
 * be handled without a new tab.
 *
 * @param {string} href
 * @returns {boolean}
 */
export function isExternal(href) {
  const origin = globalThis.location?.origin;
  if (origin) {
    try {
      return new URL(href, origin).origin !== origin;
    } catch {
      return true;
    }
  }
  // No document (unit tests): a scheme or a protocol-relative path leaves the
  // page, everything else is a path on this host.
  return /^[a-z][a-z0-9+.-]*:/i.test(href) || href.startsWith('//');
}

/**
 * A study link's title is a `{ de, en, sv }` map written by the study author, and
 * languages may be missing: fall back to English, then to any language, then to
 * the URL so the entry is never unlabelled.
 *
 * @param {unknown} title
 * @param {string} language
 * @param {string} href
 * @returns {string}
 */
export function resolveLinkTitle(title, language, href) {
  /** @param {unknown} value @returns {string | null} */
  const usable = (value) =>
    typeof value === 'string' && value.trim() !== '' ? value.trim() : null;

  const direct = usable(title);
  if (direct) return direct;
  if (!title || typeof title !== 'object') return href;

  const map = /** @type {Record<string, unknown>} */ (title);
  for (const candidate of [language, 'en']) {
    const value = usable(map[candidate]);
    if (value) return value;
  }
  for (const value of Object.values(map)) {
    const fallback = usable(value);
    if (fallback) return fallback;
  }
  return href;
}

/**
 * The links to render, in the order they should appear.
 *
 * @param {any} session The study-config payload.
 * @param {{ language: string, t: (key: string) => string }} options
 * @returns {{ footer: LegalLink[], menu: LegalLink[] }}
 */
export function legalLinks(session, { language, t }) {
  if (!session) return { footer: [], menu: [] };

  /** @type {LegalLink[]} */
  const legal = [];
  if (!session.hide_server_wide_links) {
    const imprint = url(session.imprint_url);
    const privacy = url(session.privacy_url);
    if (imprint) {
      legal.push({
        href: imprint,
        label: t('diary.shell.imprint'),
        external: isExternal(imprint),
      });
    }
    if (privacy) {
      legal.push({
        href: privacy,
        label: t('diary.shell.dataProtection'),
        external: isExternal(privacy),
      });
    }
  }

  /** @type {LegalLink[]} */
  const study = [];
  for (const link of Array.isArray(session.footer_links) ? session.footer_links : []) {
    const href = url(link?.target_url);
    if (!href) continue;
    study.push({
      href,
      label: resolveLinkTitle(link?.title, language, href),
      external: isExternal(href),
    });
  }

  return { footer: legal, menu: [...legal, ...study] };
}

/**
 * @param {LegalLink} link
 * @param {(key: string) => string} t
 * @param {string} className
 * @returns {HTMLLIElement}
 */
function listItem(link, t, className) {
  const item = document.createElement('li');
  const anchor = document.createElement('a');
  anchor.className = className;
  anchor.href = link.href;
  anchor.textContent = link.label;
  if (link.external) {
    // A legal or study page is not the diary: keep it out of the participant's
    // back-button history, and say where it opens (as the old app did).
    anchor.target = '_blank';
    anchor.rel = 'noopener';
    const hint = document.createElement('span');
    hint.className = 't-vh';
    hint.textContent = ` (${t('footer.opensInNewTab')})`;
    anchor.append(hint);
  }
  item.append(anchor);
  return item;
}

/**
 * Render into the two hosts of the markup. Both are hidden when they would be
 * empty, so a study without any link shows no footer and no "Pages" heading.
 *
 * @param {{
 *   footer: HTMLElement | null,
 *   footerList: HTMLElement | null,
 *   menuBlock: HTMLElement | null,
 *   menuList: HTMLElement | null,
 *   closeMenu: () => void,
 *   t: (key: string) => string,
 *   getLanguage: () => string,
 * }} deps
 */
export function createLegalLinks({
  footer,
  footerList,
  menuBlock,
  menuList,
  closeMenu,
  t,
  getLanguage,
}) {
  /** @param {any} session */
  function render(session) {
    const links = legalLinks(session, { language: getLanguage(), t });

    if (footerList && footer) {
      footerList.replaceChildren(
        ...links.footer.map((link) => listItem(link, t, 't-footer__link'))
      );
      footer.hidden = links.footer.length === 0;
    }

    if (menuList && menuBlock) {
      menuList.replaceChildren(
        ...links.menu.map((link) => listItem(link, t, 't-drawer__item'))
      );
      menuBlock.hidden = links.menu.length === 0;
    }
  }

  // A link that opens a new tab does not dismiss the drawer on its own; without
  // this the menu would still be open over the diary when the participant comes
  // back from it.
  const onMenuClick = () => {
    closeMenu();
  };

  return {
    render,
    connect() {
      menuList?.addEventListener('click', onMenuClick);
    },
    destroy() {
      menuList?.removeEventListener('click', onMenuClick);
    },
  };
}
