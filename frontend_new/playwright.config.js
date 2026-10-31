import { defineConfig, devices } from '@playwright/test';

/**
 * Playwright runner for the participant frontend rewrite (`frontend_new/`).
 *
 * Kept separate from the old app's runner in `frontend/`: the rewrite has its
 * own specs and its own CI job, so a change here never waits for the old E2E
 * suite.
 *
 * All three engines run. The rewrite is aimed at a nationwide rollout, and the
 * features that set its browser floor (`<dialog>`, `:has`, `dvh`) are exactly
 * the ones a Chromium-only run proves nothing about: a WebKit project is the
 * only thing that catches an iOS regression before the participants do.
 *
 * Start the stack first with `./run_dev_nginx_both.bash`; the rewrite is served
 * at `/report-new/`.
 */
const BASE_URL =
  process.env.PLAYWRIGHT_NEW_FRONTEND_URL || 'http://127.0.0.1:3000/report-new/';

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
      use: { ...devices['Desktop Chrome'] },
    },
    {
      name: 'firefox',
      use: { ...devices['Desktop Firefox'] },
    },
    {
      name: 'webkit',
      use: { ...devices['Desktop Safari'] },
    },
  ],
});
