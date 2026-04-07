const { test, expect } = require('@playwright/test');

test('return_url is preserved and shown as continue link on thank-you page', async ({ page }) => {
  const rawReturnUrl = 'https://example.org/finish?token=abc123&next=1';
  const encodedReturnUrl = encodeURIComponent(rawReturnUrl);
  const startUrl = `index.html?study_name=default&lang=en&return_url=${encodedReturnUrl}`;

  await page.goto(startUrl, { waitUntil: 'domcontentloaded' });

  await expect(page).toHaveURL(/pages\/instructions\.html/);
  await expect(new URL(page.url()).searchParams.get('return_url')).toBe(rawReturnUrl);

  await page.locator('#continueBtn').click();

  await expect(page).toHaveURL(/index\.html/);
  await expect(new URL(page.url()).searchParams.get('return_url')).toBe(rawReturnUrl);

  await expect(page.locator('#skipReportingBtn')).toBeVisible();
  await page.locator('#skipReportingBtn').click();
  await expect(page.locator('#skipConfirmationModal')).toBeVisible();
  await page.locator('#confirmSkipOk').click();

  await expect(page).toHaveURL(/pages\/thank-you\.html/);
  await expect(new URL(page.url()).searchParams.get('return_url')).toBe(rawReturnUrl);

  const continueLink = page.locator('#study-custom-message-end a.continue-link');
  await expect(continueLink).toBeVisible();
  await expect(continueLink).toHaveText('Click here to continue.');
  await expect(continueLink).toHaveAttribute('href', rawReturnUrl);
});