// @ts-check
/**
 * Shared bootstrap for the component fixture pages (D33 rule 8).
 *
 * Each view gets a real page in this directory that mounts it against the app's
 * own modules and its own locale file, and a spec that drives it. That is the
 * layer between the DOM-free unit tests and the end-to-end flows: a view is
 * rendered with a hand-made session, so a branch the fixtures cannot reach (a
 * payload without `unavailable_reason`, a thank-you page with no closing text)
 * is still testable.
 *
 * The fixtures are served by a static file server rooted at `frontend_new/`
 * (playwright.components.config.js), so imports resolve by absolute path. The
 * `window.__…` globals below belong to the test pages only - the app itself may
 * not assign to `window`, which `check-architecture.mjs` enforces.
 */
import { createTranslator } from '/src/js/data/i18n.js';

/**
 * @param {string} name
 * @param {string | null} [fallback]
 * @returns {string | null}
 */
export function param(name, fallback = null) {
  const value = new URLSearchParams(window.location.search).get(name);
  return value === null ? fallback : value;
}

/**
 * @param {string} name
 * @param {boolean} [fallback]
 * @returns {boolean}
 */
export function flag(name, fallback = false) {
  const value = param(name);
  if (value === null) return fallback;
  return value === '1' || value === 'true';
}

/**
 * The fixture root and the real translator, loaded from the shipped locale so
 * the assertions can use the strings the participant actually sees.
 *
 * @param {string} [language]
 * @returns {Promise<{ root: HTMLElement, t: (key: string, params?: Record<string, string | number>) => string }>}
 */
export async function context(language = 'de') {
  const response = await fetch(`/src/locales/${language}.json`);
  if (!response.ok) throw new Error(`could not load ${language}.json: ${response.status}`);
  const messages = await response.json();
  const { t } = createTranslator(messages);
  const root = document.getElementById('root');
  if (!(root instanceof HTMLElement)) throw new Error('the fixture page has no #root');
  return { root, t };
}

/**
 * The study parts every stage page reads, plus the caller's overrides.
 *
 * @param {Record<string, unknown>} [overrides]
 * @returns {any}
 */
export function session(overrides = {}) {
  return {
    study_name: 'Fixture: Komponentenmontage',
    selected_language: 'de',
    default_language: 'de',
    ...overrides,
  };
}
