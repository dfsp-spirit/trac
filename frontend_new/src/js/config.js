// @ts-check
/**
 * Deployment configuration. Edit this file in the deployed static tree - no
 * build step reads it, exactly like the old frontend's settings file.
 *
 * It is a module, not a `window` global (D33 rule 2), so nothing can read or
 * overwrite it from outside the app.
 */
export const config = {
  /** Served from the same origin as the app; no trailing slash. */
  apiBaseUrl: '/tud_backend/api',

  /**
   * Shared locale files live with the old frontend until cutover (D35).
   * The path is relative to this document, so serving the repository root with
   * `python3 -m http.server` makes the default work.
   */
  localesUrl: '../../frontend/src/locales',

  /** Only these three exist (D34). */
  supportedLanguages: ['de', 'en', 'sv'],
  defaultLanguage: 'en',

  /** Overridden per participant by the query string (?pid=...&study=...). */
  studyName: null,
  participantId: null,
};
