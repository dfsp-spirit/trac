// Deployment configuration for the participant frontend in Docker-based
// development. Copied over frontend/src/js/config.js by docker-compose.dev.yml.
export const config = {
  // Same origin as the app (nginx proxies /tud_backend/ to the backend).
  apiBaseUrl: '/tud_backend/api',

  // Locales ship inside the app (src/locales/).
  localesUrl: new URL('../locales/', import.meta.url).href,

  supportedLanguages: ['de', 'en', 'sv'],
  defaultLanguage: 'de',

  multiTimelinePolicy: 'ignore',

  studyName: null,
  participantId: null,
};
