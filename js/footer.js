// @ts-check
// Footer renderer: reads TUD_SETTINGS + TUD_STUDY_CONFIG and inserts footer links.
(function () {
  function resolveLocalizedText(textMap, docLang, fallback) {
    if (!textMap || typeof textMap !== 'object') return fallback;
    return (
      textMap[docLang] ||
      textMap.en ||
      Object.values(textMap).find((v) => typeof v === 'string') ||
      fallback
    );
  }

  function buildServerWideLinks(settings, docLang) {
    const imprint = settings.IMPRINT_URL || null;
    const privacy = settings.PRIVACY_URL || null;
    if (!imprint && !privacy) return [];

    const cfgLabels =
      (settings.FOOTER_LINK_LABELS && settings.FOOTER_LINK_LABELS[docLang]) ||
      settings.FOOTER_LINK_LABELS?.en || {
        imprint: 'Imprint',
        privacy: 'Privacy',
      };

    const getLabel = (key) => {
      try {
        // Optional lookup: footer.imprint / footer.privacy are usually
        // just absent, and the deployment labels below are then used.
        // A warning (and a "missing key" record triggering a locale
        // re-fetch) would be misleading for that expected case, so use
        // the non-reporting lookup.
        if (
          window.i18n &&
          typeof window.i18n.tOptional === 'function' &&
          window.i18n.isReady &&
          window.i18n.isReady()
        ) {
          const translated = window.i18n.tOptional(`footer.${key}`);
          if (typeof translated === 'string' && translated.trim() !== '')
            return translated;
        }
      } catch (e) {
        /* ignore */
      }
      return (
        (cfgLabels && cfgLabels[key]) ||
        (key === 'imprint' ? 'Imprint' : 'Privacy')
      );
    };

    const parts = [];
    if (imprint) {
      parts.push(createLinkElement(imprint, getLabel('imprint')));
    }
    if (privacy) {
      parts.push(createLinkElement(privacy, getLabel('privacy')));
    }
    return parts;
  }

  function buildStudyLinks(studyConfig, docLang) {
    if (
      !studyConfig ||
      !studyConfig.footer_links ||
      !Array.isArray(studyConfig.footer_links)
    )
      return [];
    return studyConfig.footer_links.map((link) => {
      const title = resolveLocalizedText(link.title, docLang, link.target_url);
      return createLinkElement(link.target_url, title);
    });
  }

  /** True for a target we serve ourselves, i.e. one no other site can frame-block. */
  function isSameOrigin(href) {
    try {
      return (
        new URL(href, window.location.href).origin === window.location.origin
      );
    } catch (err) {
      return false;
    }
  }

  /** "opens in a new tab", translated; the visible glyph needs no translation. */
  function newTabHint() {
    try {
      if (window.i18n && window.i18n.isReady && window.i18n.isReady()) {
        const translated = window.i18n.t('footer.opensInNewTab');
        if (typeof translated === 'string' && translated.trim() !== '') {
          return translated;
        }
      }
    } catch (e) {
      /* fall through to the English hint */
    }
    return 'opens in a new tab';
  }

  /**
   * Show one of our own pages over the current one, in an iframe dialog.
   *
   * Footer.js runs on pages that load neither the diary's ui.js nor styles.css
   * (consent, instructions, open_studies, tasks, thank-you), so a modal cannot be
   * borrowed from there - hence this small self-contained one. It exists because
   * following a footer link used to take the participant out of the study: on a
   * phone even a new tab looks like leaving, and a same-tab link loses the page
   * they were on ("if people click the footer links, they effectively left
   * study").
   *
   * Only same-origin targets are shown here: an external site can refuse framing
   * (`X-Frame-Options`, `frame-ancestors`), and a blank frame cannot be detected
   * from JS, so those keep opening in a new tab.
   */
  function openIframeModal(href, title) {
    const existing = document.getElementById('footerLinkModal');
    if (existing) existing.remove();

    const previouslyFocused =
      document.activeElement instanceof HTMLElement
        ? document.activeElement
        : null;
    const scrollLock = document.body.style.overflow;

    const overlay = document.createElement('div');
    overlay.id = 'footerLinkModalOverlay';
    overlay.style.cssText =
      'position:fixed;inset:0;background:rgba(15,23,42,0.6);z-index:10000;' +
      'display:flex;align-items:center;justify-content:center;padding:12px;';

    const dialog = document.createElement('div');
    dialog.id = 'footerLinkModal';
    dialog.setAttribute('role', 'dialog');
    dialog.setAttribute('aria-modal', 'true');
    dialog.setAttribute('aria-labelledby', 'footerLinkModalTitle');
    dialog.style.cssText =
      'background:#fff;color:#0f172a;border-radius:8px;width:100%;' +
      'max-width:900px;height:min(88vh,900px);display:flex;' +
      'flex-direction:column;overflow:hidden;box-shadow:0 10px 30px rgba(0,0,0,.3);';

    const header = document.createElement('div');
    header.style.cssText =
      'display:flex;align-items:center;justify-content:space-between;gap:12px;' +
      'padding:10px 14px;border-bottom:1px solid #e5e7eb;';

    const heading = document.createElement('h2');
    heading.id = 'footerLinkModalTitle';
    heading.textContent = title;
    heading.style.cssText = 'margin:0;font-size:1rem;';

    const closeBtn = document.createElement('button');
    closeBtn.type = 'button';
    closeBtn.textContent =
      window.i18n && window.i18n.isReady && window.i18n.isReady()
        ? window.i18n.t('buttons.close')
        : 'Close';
    closeBtn.style.cssText =
      'min-height:32px;padding:4px 12px;border:1px solid #cbd5e1;' +
      'border-radius:6px;background:#f8fafc;color:#0f172a;font:inherit;cursor:pointer;';

    const frame = document.createElement('iframe');
    frame.src = href;
    frame.title = title;
    frame.style.cssText = 'flex:1;width:100%;border:0;background:#fff;';

    header.append(heading, closeBtn);
    dialog.append(header, frame);
    overlay.appendChild(dialog);
    document.body.appendChild(overlay);
    // The page behind must not scroll while the dialog is up.
    document.body.style.overflow = 'hidden';
    closeBtn.focus();

    function close() {
      document.removeEventListener('keydown', onKeydown, true);
      overlay.remove();
      document.body.style.overflow = scrollLock;
      if (previouslyFocused) {
        previouslyFocused.focus();
      }
    }

    function onKeydown(event) {
      if (event.key === 'Escape') {
        event.preventDefault();
        close();
        return;
      }
      // Keep Tab inside the dialog: the only reachable stops are its own, the
      // iframe being one of them.
      if (event.key === 'Tab') {
        /** @type {HTMLElement[]} */
        const stops = [closeBtn, frame];
        const active =
          document.activeElement instanceof HTMLElement
            ? document.activeElement
            : null;
        const index = active ? stops.indexOf(active) : -1;
        const next =
          index === -1
            ? stops[0]
            : stops[
                (index + (event.shiftKey ? -1 : 1) + stops.length) % stops.length
              ];
        event.preventDefault();
        next.focus();
      }
    }

    closeBtn.addEventListener('click', close);
    overlay.addEventListener('click', (event) => {
      if (event.target === overlay) close();
    });
    document.addEventListener('keydown', onKeydown, true);
  }

  function createLinkElement(href, text) {
    const a = document.createElement('a');
    a.href = href;
    a.textContent = text;
    a.style.margin = '0 6px';
    a.style.color = 'inherit';
    a.style.textDecoration = 'none';
    // 13px text alone is a 16px-tall hit area; WCAG 2.2 SC 2.5.8 wants 24x24.
    a.style.display = 'inline-block';
    a.style.padding = '4px 2px';
    a.setAttribute('aria-label', text);

    if (isSameOrigin(href)) {
      // Our own content: show it here, so the participant never leaves the page
      // they are working on.
      a.setAttribute('aria-haspopup', 'dialog');
      a.addEventListener('click', (event) => {
        // Modified and middle clicks stay ordinary link clicks (new tab/window).
        if (
          event.button !== 0 ||
          event.metaKey ||
          event.ctrlKey ||
          event.shiftKey ||
          event.altKey
        ) {
          return;
        }
        event.preventDefault();
        openIframeModal(href, text);
      });
      return a;
    }

    a.target = '_blank';
    a.rel = 'noopener noreferrer';
    // Opening a tab is a change of context, so the accessible name says it; the
    // glyph is decoration and needs no translation.
    a.setAttribute('aria-label', `${text} (${newTabHint()})`);
    const glyph = document.createElement('span');
    glyph.textContent = '\u2197';
    glyph.setAttribute('aria-hidden', 'true');
    glyph.style.marginLeft = '2px';
    glyph.style.fontSize = '0.85em';
    a.appendChild(glyph);
    return a;
  }

  function buildLinks() {
    const settings = window.TUD_SETTINGS || {};
    const studyConfig = window.TUD_STUDY_CONFIG || null;
    const docLang =
      document.documentElement && document.documentElement.lang
        ? document.documentElement.lang.split('-')[0]
        : 'en';

    const hideServerWide =
      studyConfig && studyConfig.hide_server_wide_links === true;

    let links = [];
    if (!hideServerWide) {
      links = links.concat(buildServerWideLinks(settings, docLang));
    }
    links = links.concat(buildStudyLinks(studyConfig, docLang));

    return links.length > 0 ? links : null;
  }

  function findContainerForFooter() {
    // Prefer an existing global #footer — return its parent so we can
    // append into it (the #footer element itself is reused as targetFooter).
    let footerEl = document.getElementById('footer');
    if (footerEl) return footerEl.parentElement || document.body;

    // Common main containers (consent, thank-you, tasks, instructions, open-studies)
    const candidates = [
      document.querySelector('.consent-shell'),
      document.querySelector('.thank-you-container'),
      document.querySelector('.open-studies-container'),
      document.querySelector('.tasks-container'),
      document.querySelector('.instructions-footer'),
      document.querySelector('.timeline-header'),
      document.querySelector('main'),
      document.body,
    ];

    for (const el of candidates) {
      if (el) return el;
    }
    return document.body;
  }

  function renderFooter() {
    try {
      const links = buildLinks();
      if (!links || links.length === 0) return;

      const container = findContainerForFooter();

      // Reuse existing footer elements if present to avoid duplicates
      let targetFooter =
        document.getElementById('footer') ||
        document.querySelector('.trac-legal-footer');
      let created = false;
      if (!targetFooter) {
        targetFooter = document.createElement('div');
        targetFooter.className = 'trac-legal-footer';
        created = true;
      } else {
        // Remove any additional duplicates, keep only the first one
        const extras = Array.from(
          document.querySelectorAll('.trac-legal-footer')
        );
        extras.forEach((el, idx) => {
          if (el !== targetFooter) el.remove();
        });
      }

      // Ensure consistent styling
      targetFooter.style.padding = targetFooter.style.padding || '10px 8px';
      targetFooter.style.borderTop =
        targetFooter.style.borderTop || '1px solid #e5e7eb';
      targetFooter.style.fontSize = targetFooter.style.fontSize || '0.85rem';
      // Keep in step with the inline colour of the static #footer in index.html:
      // #ccc failed the axe color-contrast check (1.53:1) and #6b7280 only just
      // passed (4.78:1) on the #f8fafc page background.
      targetFooter.style.color = targetFooter.style.color || '#475569';
      targetFooter.style.textAlign = targetFooter.style.textAlign || 'center';
      targetFooter.style.marginTop = targetFooter.style.marginTop || '12px';

      // Replace only this script's own links row, never the whole footer: the
      // diary's #footer also carries the app name, the frontend version and the
      // backend status (filled by script.js), and clearing the container deleted
      // all three on every page that has footer links.
      let inner = /** @type {HTMLElement | null} */ (
        targetFooter.querySelector('.trac-legal-footer-links')
      );
      if (!inner) {
        inner = document.createElement('div');
        inner.className = 'trac-legal-footer-links';
        targetFooter.appendChild(inner);
      }
      inner.innerHTML = '';
      // Wrapping row: links were inline elements with no whitespace between them,
      // so the browser had no place to break and the German row
      // ("Impressum · Datenschutz · Studieninformation") grew to 415px and was
      // clipped on phones. Each link now keeps its separator and may wrap.
      inner.style.display = 'flex';
      inner.style.flexWrap = 'wrap';
      inner.style.justifyContent = 'center';
      inner.style.alignItems = 'center';
      inner.style.gap = '0 0.5rem';
      inner.style.maxWidth = '100%';
      links.forEach((el, idx) => {
        const item = document.createElement('span');
        item.style.whiteSpace = 'nowrap';
        item.appendChild(el);
        if (idx < links.length - 1) {
          const sep = document.createElement('span');
          sep.textContent = '·';
          sep.style.margin = '0 0 0 0.5rem';
          sep.style.color = 'inherit';
          item.appendChild(sep);
        }
        inner.appendChild(item);
      });

      if (created) {
        container.appendChild(targetFooter);
      } else {
        // If targetFooter was found but not present inside the chosen container, ensure it's placed there
        if (targetFooter.parentElement !== container) {
          container.appendChild(targetFooter);
        }
      }
    } catch (err) {
      console.warn('footer.js render failed', err);
    }
  }

  /**
   * Set a study page's tab title as "<study name> - <localized page name>",
   * falling back to the page name alone when the study name is unknown.
   *
   * Call it AFTER i18n.applyTranslations(): that pass rewrites the text of every
   * element carrying a data-i18n attribute, <title> included, so a title set
   * before it is silently overwritten. That is how the diary tab got stuck on
   * "Loading..." - its <title> was wired to the common.loading key.
   *
   * @param {{study_name?: string}|null} studyConfig
   * @param {string} pageTitleKey locale key holding the page name
   */
  function setStudyPageTitle(studyConfig, pageTitleKey) {
    if (
      !window.i18n ||
      typeof window.i18n.t !== 'function' ||
      !window.i18n.isReady()
    ) {
      // Leave the static <title> from the markup alone rather than a bare key.
      return;
    }

    const pageTitle = window.i18n.t(pageTitleKey);
    const studyName = (studyConfig && studyConfig.study_name) || '';
    document.title = studyName
      ? window.i18n.t('common.pageTitleWithStudy', {
          study: studyName,
          page: pageTitle,
        })
      : pageTitle;
  }

  window.setStudyPageTitle = setStudyPageTitle;

  // Initial render on DOM ready
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', renderFooter);
  } else {
    renderFooter();
  }

  // Re-render when i18n language changes so labels update
  window.addEventListener('i18n:languageChanged', () => {
    renderFooter();
  });

  // Re-render when study config becomes available (dispatched by pages that load it async)
  window.addEventListener('tud:studyConfigReady', () => {
    renderFooter();
  });

  // Expose for manual re-renders (e.g., after async study config load)
  window.TUDRefreshFooter = renderFooter;
})();
