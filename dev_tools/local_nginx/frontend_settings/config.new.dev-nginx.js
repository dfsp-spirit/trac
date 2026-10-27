// Deployment configuration for the frontend rewrite on the local dev server
// (nginx on port 3000). Copied over frontend_new/src/js/config.js by
// run_dev_nginx_both.bash.
export const config = {
  apiBaseUrl: '/tud_backend/api',
  localesUrl: '/locales',
  supportedLanguages: ['de', 'en', 'sv'],
  defaultLanguage: 'de',
  studyName: null,
  participantId: null,
};
