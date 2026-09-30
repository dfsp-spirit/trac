const { test, expect } = require('@playwright/test');
const { openSkipConfirmation } = require('./e2e_helpers.js');

test('instructions -> start -> skip reporting -> thank-you page', async ({
  page,
}) => {
  await page.goto('index.html?study_name=default&lang=en', {
    waitUntil: 'domcontentloaded',
  });

  await expect(page).toHaveURL(/pages\/instructions\.html/);
  await expect(page.locator('#continueBtn')).toBeVisible();

  await page.locator('#continueBtn').click();

  await page.waitForURL(/index\.html/, { timeout: 15000 });

  // Reaches the action wherever it is: its own button on desktop, the ⋮ menu on
  // a phone. It also retries until the handler is wired, which used to surface
  // as a flaky "modal stays hidden" failure in CI.
  await openSkipConfirmation(page);
  await page.locator('#confirmSkipOk').click();

  await expect(page).toHaveURL(/pages\/thank-you\.html/);
  await expect(page.locator('h1[data-i18n="thankYou.heading"]')).toBeVisible();
});
