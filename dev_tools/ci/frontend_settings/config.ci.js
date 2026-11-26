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
  // Temporary, until every study is single-timeline (D1). What to do when a
  // study's activities config still defines a second timeline ("things done in
  // parallel"): 'ignore' offers only the timeline this diary resolved to,
  // 'merge' puts every timeline's activities in one picker, and 'error' refuses
  // to run so an unconverted study is reported instead of shown wrongly.
  multiTimelinePolicy: 'ignore',

  studyName: null,
  participantId: null,
};
