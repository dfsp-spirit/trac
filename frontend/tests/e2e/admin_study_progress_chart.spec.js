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

  // Verify the chart has actually been drawn. The canvas uses pure Canvas 2D
  // API with devicePixelRatio scaling, so sample from the central plot area
  // using proportional coordinates to work across all DPR values and browsers.
  async function canvasHasDrawing(canvasEl) {
    return canvasEl.evaluate((el) => {
      const ctx = el.getContext('2d');
      if (!ctx) return false;
      // Sample ~30%×40% of the canvas centered on the plot area, independent
      // of devicePixelRatio (which scales the internal bitmap).
      const w = el.width;
      const h = el.height;
      const sx = Math.floor(w * 0.2);
      const sy = Math.floor(h * 0.15);
      const sw = Math.floor(w * 0.3);
      const sh = Math.floor(h * 0.4);
      const imageData = ctx.getImageData(sx, sy, sw, sh);
      let totalNonZero = 0;
      for (let i = 0; i < imageData.data.length; i += 4) {
        if (imageData.data[i] > 0 || imageData.data[i + 1] > 0 || imageData.data[i + 2] > 0) {
          totalNonZero++;
        }
      }
      return totalNonZero > 10;
    });
  }

  const hasDrawing = await canvasHasDrawing(canvas);
  if (!hasDrawing) {
    await page.waitForTimeout(1500);
    const retryDrawing = await canvasHasDrawing(canvas);
    expect(retryDrawing).toBe(true);
  } else {
    expect(hasDrawing).toBe(true);
  }

  // Verify the legend is visible
  await expect(
    page.locator('text=Completed time-use diary')
  ).toBeVisible();
});
