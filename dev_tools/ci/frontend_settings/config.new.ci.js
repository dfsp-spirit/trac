// Deployment configuration for the frontend rewrite, copied over
// frontend_new/src/js/config.js by the CI workflow - the same pattern the old app
// uses for `tud_settings.js`, so no build step and no source edits per host.
export const config = {
  // Same origin as the app, so no CORS and no host in the file.
  apiBaseUrl: '/tud_backend/api',

  // Served by nginx from frontend/src/locales (D35: one set of locale files).
    // Locales ship inside the app (src/locales/, kept identical to
  // frontend/src/locales by `npm run sync:locales`). Resolving against this
  // module rather than the site root means the app can be mounted anywhere -
  // /report-new/ today, /report/ after the cutover - with no web-server alias.
  localesUrl: new URL('../locales/', import.meta.url).href,

  supportedLanguages: ['de', 'en', 'sv'],
  defaultLanguage: 'de',

  // Per participant from the query string; these are the fallbacks.
  studyName: null,
  participantId: null,
};
