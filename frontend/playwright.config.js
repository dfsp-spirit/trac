import { defineConfig, devices } from '@playwright/test';

/**
 * Playwright runner for the participant frontend (`frontend/`).
 *
 * All three engines run. The app is aimed at a nationwide rollout, and the
 * features that set its browser floor (`<dialog>`, `:has`, `dvh`) are exactly
 * the ones a Chromium-only run proves nothing about: a WebKit project is the
 * only thing that catches an iOS regression before the participants do.
 *
 * Start the stack first with `./run_dev_nginx_both.bash`; the frontend is served
 * at `/report/`.
 */
const BASE_URL =
  process.env.PLAYWRIGHT_BASE_URL || 'http://127.0.0.1:3000/report/';

export default defineConfig({
  testDir: './tests/e2e',
  timeout: 40_000,
  expect: {
    timeout: 10_000,
  },
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: 1,
  reporter: process.env.CI
    ? [['github'], ['html', { outputFolder: 'playwright-report', open: 'never' }]]
    : [['list'], ['html', { outputFolder: 'playwright-report', open: 'never' }]],
  outputDir: 'test-results',
  use: {
    baseURL: BASE_URL,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  projects: [
    {
      name: 'chromium',
      testIgnore: /admin\//,
      use: { ...devices['Desktop Chrome'] },
    },
    {
      name: 'firefox',
      testIgnore: /admin\//,
      use: { ...devices['Desktop Firefox'] },
    },
    {
      name: 'webkit',
      testIgnore: /admin\//,
      use: { ...devices['Desktop Safari'] },
    },
    // The participants are on phones, so the two engines are also covered at the
    // widths that actually hurt: 320px (iPhone SE, the narrowest phone still in
    // use) and 393px (Pixel 5). Both expose the panel as a modal dialog instead
    // of the third desktop column, which is a different code path.
    {
      name: 'mobile-safari',
      testIgnore: /admin\//,
      use: { ...devices['iPhone SE'], browserName: 'webkit' },
    },
    {
      name: 'mobile-chrome',
      testIgnore: /admin\//,
      use: { ...devices['Pixel 5'], browserName: 'chromium' },
    },
    // Admin portal specs: they exercise the backend's Jinja UI, not the
    // participant app, so one desktop engine is enough.
    {
      name: 'admin-chromium',
      testMatch: /admin\/.*\.spec\.js/,
      use: { ...devices['Desktop Chrome'] },
    },
  ],
});
