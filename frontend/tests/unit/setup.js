// Minimal browser/global shim so pure frontend modules can be imported and
// tested under node:test. Several src modules touch `window` / `TUD_SETTINGS`
// at module-load time (e.g. study_config_manager.js and i18n.js assign
// globals). We only define the fields those modules actually read at import;
// individual tests stub anything deeper they need.
//
// Loaded automatically by the test runner via:
//   node --test --import ./tests/unit/setup.js ./tests/unit/

const fakeLocation = new URL('http://localhost/report/index.html');

globalThis.TUD_SETTINGS = {
  API_BASE_URL: 'http://localhost:8000/tud_backend/api',
  DEFAULT_STUDY_NAME: 'default',
  DEFAULT_STUDIES_FILE: 'settings/studies_config.json',
};

globalThis.window = {
  location: fakeLocation,
  innerWidth: 1280,
  addEventListener() {},
  removeEventListener() {},
  dispatchEvent() {},
  getComputedStyle() {
    return { getPropertyValue: () => '' };
  },
};

globalThis.document = {
  documentElement: { lang: 'en' },
  body: {},
  head: {},
  querySelector() {
    return null;
  },
  querySelectorAll() {
    return [];
  },
  getElementById() {
    return null;
  },
  createElement() {
    return {
      style: {},
      dataset: {},
      classList: { add() {}, remove() {}, toggle() {} },
      setAttribute() {},
      appendChild() {},
    };
  },
  addEventListener() {},
};

globalThis.navigator = {
  languages: ['en-US'],
  language: 'en-US',
};
