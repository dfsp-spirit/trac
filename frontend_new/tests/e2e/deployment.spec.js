/**
 * The frontend rewrite is deployed next to the old app and can reach the backend.
 *
 * This is the wiring check, not a behaviour test: the rewrite has its own unit
 * gates and its own behaviour specs; what can only break in deployment is that
 * nginx serves it, that its config file reaches the browser, that the shared
 * locale files are reachable from it, and that the stage machine gets an answer
 * from the API. Those four things are what this pins.
 */
import { test, expect } from '@playwright/test';

const NEW_FRONTEND_URL =
  process.env.PLAYWRIGHT_NEW_FRONTEND_URL || 'http://127.0.0.1:3000/report-new/';

/** A participant that exists in the shipped study config. */
const STUDY = 'adult_pilot_de';
const PARTICIPANT = 'pending_12';

test.describe('frontend rewrite deployment', () => {
  test('the app serves its own locale files where it is mounted', async ({
    request,
  }) => {
    // Self-contained on purpose: the rewrite carries `locales/` next to itself,
    // so it works at any mount point and needs no web-server alias (D35). This
    // would fail if the copy were dropped from `frontend_new/src/`.
    for (const language of ['de', 'en', 'sv']) {
      const url = new URL(`locales/${language}.json`, NEW_FRONTEND_URL).toString();
      const response = await request.get(url);
      expect(response.ok(), url).toBeTruthy();
      const messages = await response.json();
      expect(messages.diary?.stage?.consentTitle).toBeTruthy();
    }
  });

  test('the app loads, routes to a stage, and gets one from the backend', async ({
    page,
  }) => {
    const consoleErrors = [];
    page.on('pageerror', (error) => consoleErrors.push(String(error)));

    await page.goto(`${NEW_FRONTEND_URL}?study=${STUDY}&pid=${PARTICIPANT}`);

    // The route guard puts the URL on the stage the server reported (D37). A
    // failure page never settles on a known route, so this also proves the API
    // answered: without the config file there is no apiBaseUrl and only the
    // failure message renders.
    await expect
      .poll(() => page.evaluate(() => window.location.hash))
      .toMatch(/^#\/(consent|instructions|diary|tasks|thanks|unavailable)$/);

    const hash = await page.evaluate(() => window.location.hash);
    if (hash === '#/diary') {
      // The diary owns the shell; the stage host is hidden in this stage.
      await expect(page.locator('.t-shell')).toBeVisible();
    } else {
      // Every other stage is the shared page frame (D40).
      await expect(page.locator('.t-stage .t-page__title')).toBeVisible();
    }

    expect(consoleErrors).toEqual([]);
  });
});
