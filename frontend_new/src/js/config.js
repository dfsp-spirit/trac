// Deployment configuration for the frontend rewrite on the local dev server
// (nginx on port 3000). Copied over frontend_new/src/js/config.js by
// run_dev_nginx_both.bash.
export const config = {
  apiBaseUrl: '/tud_backend/api',
    // Locales ship inside the app (src/locales/, kept identical to
  // frontend/src/locales by `npm run sync:locales`). Resolving against this
  // module rather than the site root means the app can be mounted anywhere -
  // /report-new/ today, /report/ after the cutover - with no web-server alias.
  localesUrl: new URL('../locales/', import.meta.url).href,
  supportedLanguages: ['de', 'en', 'sv'],
  defaultLanguage: 'de',
  studyName: null,
  participantId: null,
};
