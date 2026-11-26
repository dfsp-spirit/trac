/**
 * The frontend is deployed and can reach the backend.
 *
 * This is the wiring check, not a behaviour test: the app has its own unit
 * gates and its own behaviour specs; what can only break in deployment is that
 * nginx serves it, that its config file reaches the browser, that its own
 * locale files are reachable from it, and that the stage machine gets an answer
 * from the API. Those four things are what this pins.
 */
import { test, expect } from '@playwright/test';

const FRONTEND_URL =
  process.env.PLAYWRIGHT_BASE_URL || 'http://127.0.0.1:3000/report/';

/**
 * Two fixtures, one per kind of stage: the diary owns the shell, every other
 * stage is the page frame. They come from `studies_config_new.json` with the
 * rest of the fixtures.
 */
const CASES = [
  { study: 'newui_06_diary', participant: 'diary_02', stage: 'diary' },
  { study: 'newui_07_consent', participant: 'consent_02', stage: 'consent' },
];

test.describe('frontend deployment', () => {
  test('the app serves its own locale files where it is mounted', async ({
    request,
  }) => {
    // Self-contained on purpose: the app carries `locales/` next to itself, so
    // it works at any mount point and needs no web-server alias (D35). This
    // would fail if `src/locales/` were dropped from the deployment.
    for (const language of ['de', 'en', 'sv']) {
      const url = new URL(`locales/${language}.json`, FRONTEND_URL).toString();
      const response = await request.get(url);
      expect(response.ok(), url).toBeTruthy();
      const messages = await response.json();
      expect(messages.diary?.stage?.consentTitle).toBeTruthy();
    }
  });

  for (const { study, participant, stage } of CASES) {
    test(`the app loads, routes to a stage, and gets one from the backend (${stage})`, async ({
      page,
    }) => {
      const consoleErrors = [];
      page.on('pageerror', (error) => consoleErrors.push(String(error)));

      await page.goto(`${FRONTEND_URL}?study=${study}&pid=${participant}`);

      // The route guard puts the URL on the stage the server reported (D37). A
      // failure page never settles on a known route, so this also proves the API
      // answered: without the config file there is no apiBaseUrl and only the
      // failure message renders.
      await expect
        .poll(() => page.evaluate(() => window.location.hash))
        .toBe(`#/${stage}`);

      if (stage === 'diary') {
        // The diary owns the shell; the stage host is hidden in this stage.
        await expect(page.locator('.t-shell')).toBeVisible();
        await expect(page.locator('#stage-host')).toBeHidden();
      } else {
        // Every other stage is the shared page frame (D40).
        await expect(page.locator('.t-stage .t-page__title')).toBeVisible();
        await expect(page.locator('.t-shell')).toBeHidden();
      }

      expect(consoleErrors).toEqual([]);
    });
  }
});
