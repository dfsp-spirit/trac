// Deployment configuration for the participant frontend on the local dev server
// (nginx on port 3000). Copied over frontend/src/js/config.js by
// run_dev_nginx_both.bash.
export const config = {
  apiBaseUrl: '/tud_backend/api',

  // Locales ship inside the app (src/locales/). Resolving against this module
  // rather than the site root means the app can be mounted anywhere - /report/
  // today - with no web-server alias.
  localesUrl: new URL('../locales/', import.meta.url).href,

  supportedLanguages: ['de', 'en', 'sv'],
  defaultLanguage: 'de',

  // Safety net for an imported legacy config that still defines a second
  // timeline: 'ignore' shows only the resolved timeline, 'merge' puts every
  // timeline's activities in one picker, and 'error' refuses to run.
  multiTimelinePolicy: 'ignore',

  studyName: null,
  participantId: null,
};
