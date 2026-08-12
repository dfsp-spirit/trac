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
  await page.getByRole('button', { name: /📈 Progress/i }).click();

  // Verify the Progress tab panel is visible
  await expect(
    page.locator('h3:has-text("Cumulative Participant Completion")')
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
