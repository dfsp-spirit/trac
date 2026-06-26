// Footer renderer: reads TUD_SETTINGS + TUD_STUDY_CONFIG and inserts footer links.
    (function () {
        function resolveLocalizedText(textMap, docLang, fallback) {
            if (!textMap || typeof textMap !== 'object') return fallback;
            return textMap[docLang] || textMap.en || Object.values(textMap).find(v => typeof v === 'string') || fallback;
        }

        function buildServerWideLinks(settings, docLang) {
            const imprint = settings.IMPRINT_URL || null;
            const privacy = settings.PRIVACY_URL || null;
            if (!imprint && !privacy) return [];

            const openInNew = settings.OPEN_LEGAL_LINKS_IN_NEW_TAB !== false;
            const cfgLabels = (settings.FOOTER_LINK_LABELS && settings.FOOTER_LINK_LABELS[docLang]) || settings.FOOTER_LINK_LABELS?.en || { imprint: 'Imprint', privacy: 'Privacy' };

            const getLabel = (key) => {
                try {
                    if (window.i18n && typeof window.i18n.t === 'function' && window.i18n.isReady && window.i18n.isReady()) {
                        const translated = window.i18n.t(`footer.${key}`);
                        if (typeof translated === 'string' && translated !== `footer.${key}`) return translated;
                    }
                } catch (e) { /* ignore */ }
                return (cfgLabels && cfgLabels[key]) || (key === 'imprint' ? 'Imprint' : 'Privacy');
            };

            const parts = [];
            if (imprint) {
                parts.push(createLinkElement(imprint, getLabel('imprint'), openInNew));
            }
            if (privacy) {
                parts.push(createLinkElement(privacy, getLabel('privacy'), openInNew));
            }
            return parts;
        }

        function buildStudyLinks(studyConfig, docLang) {
            if (!studyConfig || !studyConfig.footer_links || !Array.isArray(studyConfig.footer_links)) return [];
            return studyConfig.footer_links.map(link => {
                const title = resolveLocalizedText(link.title, docLang, link.target_url);
                return createLinkElement(link.target_url, title, link.in_new_tab !== false);
            });
        }

        function createLinkElement(href, text, openInNew) {
            const a = document.createElement('a');
            a.href = href;
            a.textContent = text;
            a.style.margin = '0 6px';
            a.style.color = 'inherit';
            a.style.textDecoration = 'none';
            a.setAttribute('aria-label', text);
            if (openInNew) {
                a.target = '_blank';
                a.rel = 'noopener noreferrer';
            }
            return a;
        }

        function buildLinks() {
            const settings = window.TUD_SETTINGS || {};
            const studyConfig = window.TUD_STUDY_CONFIG || null;
            const docLang = (document.documentElement && document.documentElement.lang) ? document.documentElement.lang.split('-')[0] : 'en';

            const hideServerWide = studyConfig && studyConfig.hide_server_wide_links === true;

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

            // Common main containers (consent, thank-you, tasks, instructions)
            const candidates = [
                document.querySelector('.consent-shell'),
                document.querySelector('.thank-you-container'),
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
                let targetFooter = document.getElementById('footer') || document.querySelector('.trac-legal-footer');
                let created = false;
                if (!targetFooter) {
                    targetFooter = document.createElement('div');
                    targetFooter.className = 'trac-legal-footer';
                    created = true;
                } else {
                    // Remove any additional duplicates, keep only the first one
                    const extras = Array.from(document.querySelectorAll('.trac-legal-footer'));
                    extras.forEach((el, idx) => {
                        if (el !== targetFooter) el.remove();
                    });
                }

                // Ensure consistent styling
                targetFooter.style.padding = targetFooter.style.padding || '10px 8px';
                targetFooter.style.borderTop = targetFooter.style.borderTop || '1px solid #e5e7eb';
                targetFooter.style.fontSize = targetFooter.style.fontSize || '0.85rem';
                targetFooter.style.color = targetFooter.style.color || '#6b7280';
                targetFooter.style.textAlign = targetFooter.style.textAlign || 'center';
                targetFooter.style.marginTop = targetFooter.style.marginTop || '12px';

                // Clear and append
                targetFooter.innerHTML = '';
                const inner = document.createElement('div');
                inner.style.display = 'inline-block';
                inner.style.gap = '8px';
                links.forEach((el, idx) => {
                    inner.appendChild(el);
                    if (idx < links.length - 1) {
                        const sep = document.createElement('span');
                        sep.textContent = '·';
                        sep.style.margin = '0 6px';
                        sep.style.color = 'inherit';
                        inner.appendChild(sep);
                    }
                });
                targetFooter.appendChild(inner);

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
