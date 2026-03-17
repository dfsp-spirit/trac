const { test, expect } = require('@playwright/test');

test('instructions -> start -> skip reporting -> thank-you page', async ({ page }) => {
  await page.goto('/index.html?study=default&lang=en', { waitUntil: 'domcontentloaded' });

  await expect(page).toHaveURL(/pages\/instructions\.html/);
  await expect(page.locator('#continueBtn')).toBeVisible();

  await page.locator('#continueBtn').click();

  await expect(page).toHaveURL(/index\.html/);
  await expect(page.locator('#skipReportingBtn')).toBeVisible();

  await page.locator('#skipReportingBtn').click();
  await expect(page.locator('#skipConfirmationModal')).toBeVisible();
  await page.locator('#confirmSkipOk').click();

  await expect(page).toHaveURL(/pages\/thank-you\.html/);
  await expect(page.locator('h1[data-i18n="thankYou.heading"]')).toBeVisible();
});