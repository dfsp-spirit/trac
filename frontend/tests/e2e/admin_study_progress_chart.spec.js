const { test, expect } = require('@playwright/test');

const ADMIN_BASE_URL =
  process.env.PLAYWRIGHT_ADMIN_BASE_URL || 'http://127.0.0.1:3000/tud_backend';
const ADMIN_USER =
  process.env.PLAYWRIGHT_ADMIN_USER || 'timeusediary_api_admin';
const ADMIN_PASS =
  process.env.PLAYWRIGHT_ADMIN_PASS || 'timeusediary_api_admin_password';

test('admin study detail -> progress tab shows cumulative completion chart', async ({
  page,
}) => {
  test.skip(
    !ADMIN_USER || !ADMIN_PASS,
    'Set PLAYWRIGHT_ADMIN_USER and PLAYWRIGHT_ADMIN_PASS to run admin e2e test.'
  );

  const auth = Buffer.from(`${ADMIN_USER}:${ADMIN_PASS}`).toString('base64');
  await page.context().setExtraHTTPHeaders({
    Authorization: `Basic ${auth}`,
  });

  // Navigate to the "default" study detail page
  await page.goto(`${ADMIN_BASE_URL}/admin/study/default`, {
    waitUntil: 'domcontentloaded',
  });

  // Verify we're on the study detail page
  await expect(page.locator('h1')).toContainText('default');

  // Click on the Progress tab
  await page.getByRole('button', { name: 'Progress', exact: true }).click();

  // Verify the Progress tab panel is visible
  await expect(
    page.getByRole('heading', { name: /cumulative participant completion/i })
  ).toBeVisible();

  // Verify the chart canvas exists
  const canvas = page.locator('canvas[id^="completionChart-"]');
  await expect(canvas).toBeVisible();

  // Verify the chart has actually been drawn. The drawCompletionChart()
  // function sets data-drawn="true" on the canvas when it finishes.
  await expect(canvas).toHaveAttribute('data-drawn', 'true', { timeout: 5000 });

  // Verify the legend is visible
  await expect(
    page.locator('text=Completed time-use diary')
  ).toBeVisible();
});


test('admin study detail -> short name rule and live validation', async ({ page }) => {
  test.skip(
    !ADMIN_USER || !ADMIN_PASS,
    'Set PLAYWRIGHT_ADMIN_USER and PLAYWRIGHT_ADMIN_PASS to run admin e2e test.'
  );

  const auth = Buffer.from(`${ADMIN_USER}:${ADMIN_PASS}`).toString('base64');
  await page.context().setExtraHTTPHeaders({
    Authorization: `Basic ${auth}`,
  });

  await page.goto(`${ADMIN_BASE_URL}/admin/study/default`, {
    waitUntil: 'domcontentloaded',
  });

  await page.locator('#edit-section-toggle-btn').click();
  const shortInput = page.locator('.study-rename-short-input');
  const feedback = page.locator('[id^="rename-short-feedback-"]');

  await expect(shortInput).toBeEnabled();
  await expect(page.locator('[id^="rename-short-rule-"]')).toContainText(
    '2 to 50 characters'
  );

  await shortInput.fill('Bad Name!');
  await expect(feedback).toContainText("Invalid short name 'Bad Name!'");

  await shortInput.fill('default');
  await expect(feedback).toContainText('current short name');

  await shortInput.fill('valid_short_name');
  await expect(feedback).toContainText('looks valid');
});
