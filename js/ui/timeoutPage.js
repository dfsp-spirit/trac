import { applyTranslations } from './i18n-dom.js';

/**
 * Localize the standalone timeout page and apply optional study-authored text.
 *
 * The page deliberately receives no study or participant identifier and renders
 * no invitation link: reopening the invitation is the participant's action.
 *
 * @param {{
 *   root: HTMLElement,
 *   params: URLSearchParams,
 *   translator: { t: (key: string, params?: Record<string, string | number>) => string },
 *   language: string,
 * }} input
 * @returns {{ language: string }}
 */
export function mountTimeoutPage({ root, params, translator, language }) {
  applyTranslations(root, translator);
  root.lang = language;
  document.title = translator.t('diary.timeout.pageTitle');

  const customText = params.get('text');
  const body = root.querySelector('[data-timeout-body]');
  if (customText && body) body.textContent = customText;
  return { language };
}
