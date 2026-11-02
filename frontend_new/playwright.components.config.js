import { defineConfig, devices } from '@playwright/test';

/**
 * Component mount tests (D33 rule 8): each view is rendered on its own fixture
 * page, with no backend and no build step.
 *
 * Separate from playwright.config.js on purpose. The end-to-end suite needs
 * nginx, the API and a seeded database; a mount test needs a static file server,
 * because the fixtures import the app's ES modules by absolute path and that
 * requires one origin. Keeping them apart means a broken view fails in seconds
 * instead of after the whole stack has booted, and the e2e legs do not pay for
 * tests that cannot differ between browsers.
 */
const PORT = Number(process.env.PLAYWRIGHT_COMPONENTS_PORT || 4321);

export default defineConfig({
  testDir: './tests/components',
  timeout: 20_000,
  expect: {
    timeout: 5_000,
  },
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  reporter: process.env.CI ? [['github'], ['list']] : [['list']],
  use: {
    baseURL: `http://127.0.0.1:${PORT}/tests/components/`,
    trace: 'retain-on-failure',
  },
  // Serving `frontend_new/` is enough: `/src/js/...` resolves for the fixture
  // imports and `/src/locales/...` for the translator.
  webServer: {
    command: `python3 -m http.server ${PORT} --bind 127.0.0.1`,
    port: PORT,
    reuseExistingServer: !process.env.CI,
    stdout: 'ignore',
    stderr: 'pipe',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
});
