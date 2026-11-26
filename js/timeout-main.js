// @ts-check
/**
 * Entry point for the standalone timeout page. It is intentionally separate
 * from the diary: no shell, no API bootstrap, no participant identifiers.
 */
import { config } from './config.js';
import { createTranslator, loadLocaleWithFallback } from './data/i18n.js';
import { mountTimeoutPage } from './ui/timeoutPage.js';

const root = /** @type {HTMLElement | null} */ (document.querySelector('main'));
if (root) {
  const params = new URLSearchParams(window.location.search);
  const requestedRaw = params.get('lang') || config.defaultLanguage;
  const requested = config.supportedLanguages.includes(requestedRaw)
    ? requestedRaw
    : config.defaultLanguage;
  loadLocaleWithFallback(requested, config.defaultLanguage)
    .then(({ messages, language }) => {
      const translator = createTranslator(messages);
      mountTimeoutPage({ root, params, translator, language });
      document.documentElement.lang = language;
    })
    .catch((error) => {
      // The HTML already carries English fallback text; the page must remain
      // usable even when the locale file cannot be fetched.
      console.error('[timeout] could not load translations:', error);
    });
}
