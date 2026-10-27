/**
 * The frontend rewrite is deployed next to the old app and can reach the backend.
 *
 * This is the wiring check, not a behaviour test: the rewrite has its own unit
 * gates and gets its own specs; what can only break in deployment is that nginx
 * serves it, that its config file reaches the browser, that the shared locale
 * files are reachable from it, and that the stage machine gets an answer from the
 * API. Those four things are what this pins.
 *
 * Lives here because this is where the Playwright runner and its browsers live;
 * it moves into frontend_new/ when the old suite goes away.
 */
const { test, expect } = require('@playwright/test');

const NEW_FRONTEND_URL =
  process.env.PLAYWRIGHT_NEW_FRONTEND_URL || 'http://127.0.0.1:3000/report-new/';
const ORIGIN = new URL(NEW_FRONTEND_URL).origin;

/** A participant that exists in the shipped study config. */
const STUDY = 'adult_pilot_de';
const PARTICIPANT = 'pending_12';

test.describe('frontend rewrite deployment', () => {
  test('the shared locale files are served where the rewrite expects them', async ({
    request,
  }) => {
    for (const language of ['de', 'en', 'sv']) {
      const response = await request.get(`${ORIGIN}/locales/${language}.json`);
      expect(response.ok(), `/locales/${language}.json`).toBeTruthy();
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

    // One of the stages renders - which one depends on this participant's state
    // in this database, and all of them are legitimate here.
    await expect(
      page.locator('.t-stage .t-page-head h1, .t-stage .t-confirm h2, .t-stage .t-notice').first()
    ).toBeVisible({ timeout: 15000 });

    // The route guard put the URL on the stage the server reported (D37), so the
    // hash is always one of the known routes and never a page of its own choosing.
    const hash = await page.evaluate(() => window.location.hash);
    expect([
      '#/consent',
      '#/instructions',
      '#/diary',
      '#/tasks',
      '#/thanks',
      '#/unavailable',
    ]).toContain(hash);

    // A resolved API call means the config file reached the browser with a usable
    // apiBaseUrl: without it the app only shows the failure message.
    await expect(page.locator('.t-stage .t-hint')).toHaveCount(0);
    expect(consoleErrors).toEqual([]);
  });
});
