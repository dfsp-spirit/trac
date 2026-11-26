// Deployment configuration for the participant frontend, copied over
// frontend/src/js/config.js by the CI workflow - no build step and no source
// edits per host.
export const config = {
  // Same origin as the app, so no CORS and no host in the file.
  apiBaseUrl: '/tud_backend/api',

  // Locales ship inside the app (src/locales/). Resolving against this module
  // rather than the site root means the app can be mounted anywhere - /report/
  // today - with no web-server alias.
  localesUrl: new URL('../locales/', import.meta.url).href,

  supportedLanguages: ['de', 'en', 'sv'],
  defaultLanguage: 'de',

  // Per participant from the query string; these are the fallbacks.
  // Safety net for an imported legacy config that still defines a second
  // timeline: 'ignore' shows only the resolved timeline, 'merge' puts every
  // timeline's activities in one picker, and 'error' refuses to run.
  multiTimelinePolicy: 'ignore',

  studyName: null,
  participantId: null,
};
