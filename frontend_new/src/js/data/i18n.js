// @ts-check
/**
 * Locale loading and translation lookup. Only this layer talks to the network
 * (D33 rule: no fetch outside js/data), and it owns no DOM: applying a
 * translation to an element is ui/i18n-dom.js's job.
 *
 * The locale files are the shared ones under frontend/src/locales (D35); keys
 * for this app live under `diary.*` and values are plain text (no HTML).
 */
import { config } from '../config.js';

/**
 * @typedef {(key: string, params?: Record<string, string | number>) => string} Translator
 * @typedef {Record<string, unknown>} Messages
 */

/**
 * @param {string} language
 * @returns {Promise<Messages>}
 */
export async function loadLocale(language) {
  const url = `${config.localesUrl.replace(/\/$/, '')}/${language}.json`;
  const response = await fetch(url, { cache: 'no-cache' });
  if (!response.ok) {
    throw new Error(`Could not load ${language} translations (HTTP ${response.status})`);
  }
  return response.json();
}

/**
 * @param {Messages} messages
 * @param {string} key Dot path, e.g. "diary.shell.submit".
 * @returns {unknown}
 */
function lookup(messages, key) {
  return key.split('.').reduce((node, part) => {
    if (node && typeof node === 'object' && part in node) {
      return /** @type {Record<string, unknown>} */ (node)[part];
    }
    return undefined;
  }, /** @type {unknown} */ (messages));
}

/**
 * @param {string} template
 * @param {Record<string, string | number>} [params]
 * @returns {string}
 */
function interpolate(template, params) {
  if (!params) return template;
  return template.replace(/\{\{(\w+)\}\}/g, (match, name) =>
    Object.prototype.hasOwnProperty.call(params, name) ? String(params[name]) : match
  );
}

/**
 * Build the translator handed to components.
 *
 * A missing key returns the key itself and warns once, so a gap shows up in
 * development instead of silently rendering an empty string.
 *
 * @param {Messages} messages
 * @returns {{ t: Translator, tCount: (key: string, count: number) => string, has: (key: string) => boolean }}
 */
export function createTranslator(messages) {
  /** @type {Set<string>} */
  const warned = new Set();

  /** @type {Translator} */
  const t = (key, params) => {
    const value = lookup(messages, key);
    if (typeof value !== 'string') {
      if (!warned.has(key)) {
        warned.add(key);
        console.warn(`[i18n] missing key: ${key}`);
      }
      return key;
    }
    return interpolate(value, params);
  };

  /**
   * `_one` / `_other` suffixed keys; en, de and sv need exactly those two forms.
   *
   * @param {string} key
   * @param {number} count
   */
  const tCount = (key, count) => {
    const suffix = count === 1 ? '_one' : '_other';
    const value = lookup(messages, `${key}${suffix}`);
    if (typeof value !== 'string') return t(key, { count });
    return interpolate(value, { count });
  };

  /** @param {string} key */
  const has = (key) => typeof lookup(messages, key) === 'string';

  return { t, tCount, has };
}
