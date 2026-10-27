// @ts-check
/**
 * Applies translations to markup. Kept apart from the loader so that
 * js/data/i18n.js stays DOM-free and unit-testable, and so components never
 * need to know how a key becomes text.
 *
 * Supported hooks, same vocabulary as the old frontend:
 *   data-i18n              -> textContent
 *   data-i18n-aria-label   -> aria-label
 *   data-i18n-title        -> title
 *   data-i18n-placeholder  -> placeholder
 *
 * A key that is missing from the locale leaves the markup's own text in place:
 * the English fallback in the HTML is the design, not an error.
 */

/** @typedef {{ t: (key: string, params?: Record<string, string | number>) => string }} Translator */

const ATTRIBUTE_HOOKS = [
  ['data-i18n-aria-label', 'aria-label'],
  ['data-i18n-title', 'title'],
  ['data-i18n-placeholder', 'placeholder'],
];

/**
 * @param {ParentNode} root
 * @param {Translator} translator
 * @param {{ skipMissing?: boolean }} [options]
 */
export function applyTranslations(root, translator, options = {}) {
  const { skipMissing = true } = options;
  /** @param {string} key @param {string} value */
  const isMissing = (key, value) => skipMissing && value === key;

  for (const element of root.querySelectorAll('[data-i18n]')) {
    const key = element.getAttribute('data-i18n');
    if (!key) continue;
    const value = translator.t(key);
    if (!isMissing(key, value)) element.textContent = value;
  }

  for (const [hook, attribute] of ATTRIBUTE_HOOKS) {
    for (const element of root.querySelectorAll(`[${hook}]`)) {
      const key = element.getAttribute(hook);
      if (!key) continue;
      const value = translator.t(key);
      if (!isMissing(key, value)) element.setAttribute(attribute, value);
    }
  }
}
