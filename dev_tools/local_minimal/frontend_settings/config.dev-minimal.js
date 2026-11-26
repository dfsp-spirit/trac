// Deployment configuration for the participant frontend when it is served by
// Python's built-in HTTP server and talks to uvicorn directly.
export const config = {
  // Absolute backend origin: the frontend runs on :3000, the API on :8000.
  apiBaseUrl: 'http://localhost:8000/api',

  // Locales ship inside the app (src/locales/).
  localesUrl: new URL('../locales/', import.meta.url).href,

  supportedLanguages: ['de', 'en', 'sv'],
  defaultLanguage: 'de',

  // Safety net for an imported legacy config that still defines a second
  // timeline: 'ignore' shows only the resolved timeline.
  multiTimelinePolicy: 'ignore',

  studyName: null,
  participantId: null,
};
