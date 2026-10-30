// @ts-check
/**
 * Which UI language to use (D40), as pure decisions.
 *
 * Three things were wrong when the rewrite booted: it ignored the study's own
 * language (a German-only study rendered English chrome around German text), it
 * ignored the browser, and the language menu offered every locale the app ships
 * instead of the ones the study has. The *loading* of a locale stays in the
 * composition root; only the decisions live here, so they can be tested without
 * a DOM or a network.
 */

/**
 * The language to start with: the URL wins, then the browser, then the
 * deployment default.
 *
 * @param {{
 *   requested?: string | null,
 *   browserLanguages?: readonly string[],
 *   supported: readonly string[],
 *   fallback: string,
 * }} input
 * @returns {string}
 */
export function pickInitialLanguage({ requested, browserLanguages = [], supported, fallback }) {
  if (requested && supported.includes(requested)) return requested;
  for (const tag of browserLanguages) {
    const base = String(tag || '').slice(0, 2).toLowerCase();
    if (supported.includes(base)) return base;
  }
  return fallback;
}

/**
 * The language the study resolved to, when the URL did not ask for one.
 *
 * The server already picks the study's language (requested if the study supports
 * it, otherwise the study default) and reports it as `selected_language`, so the
 * client does not need a second request to agree with it.
 *
 * @param {{
 *   selected?: string | null,
 *   explicit?: string | null,
 *   current: string,
 *   supported: readonly string[],
 * }} input
 * @returns {string | null} The language to switch to, or null to stay put.
 */
export function followStudyLanguage({ selected, explicit, current, supported }) {
  if (explicit) return null;
  if (!selected || selected === current) return null;
  return supported.includes(selected) ? selected : null;
}

/**
 * The languages the menu may offer: what the study ships, narrowed to what the
 * app can render.
 *
 * @param {readonly string[] | null | undefined} studyLanguages
 * @param {readonly string[]} appSupported
 * @returns {string[]}
 */
export function studyLanguageOptions(studyLanguages, appSupported) {
  const languages = (studyLanguages || []).filter((language) => appSupported.includes(language));
  return languages.length ? [...new Set(languages)] : [...appSupported];
}

/**
 * Whether the menu offers a language choice at all.
 *
 * A study that ships one language has nothing to choose, and a select with a
 * single option is clutter that also invites a pointless reload - so the entry
 * only exists when there is a real choice to make.
 *
 * @param {readonly string[] | null | undefined} languages
 * @returns {boolean}
 */
export function offersLanguageChoice(languages) {
  return new Set(languages || []).size > 1;
}
