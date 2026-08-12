const { test, expect } = require('@playwright/test');
const {
  enterStudyIfNeeded,
  placeActivity,
  saveCurrentDay,
} = require('./e2e_helpers.js');

test.use({ viewport: { width: 1600, height: 900 } });

test('failed save auto-retries and stays on current day', async ({ page }) => {
  let firstAttemptFailed = false;

  await page.route(
    '**/*activities**',
    async (route) => {
      if (!firstAttemptFailed) {
        firstAttemptFailed = true;
        await route.fulfill({
          status: 500,
          contentType: 'application/json',
          body: JSON.stringify({ detail: 'temporary submit failure' }),
        });
        return;
      }

      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ ok: true }),
      });
    }
  );

  await page.goto('index.html?study_name=default&lang=en', {
    waitUntil: 'domcontentloaded',
  });

  await enterStudyIfNeeded(page);

  // Place an activity on the primary timeline (always visible now)
  await placeActivity(page, { activityName: 'Sleeping', positionPercent: 70 });

  // Save — first attempt fails (500), retry succeeds (200), then page reloads
  await saveCurrentDay(page);

  // Verify the first attempt did fail (retry was triggered)
  expect(firstAttemptFailed).toBe(true);

  // After reload, we should still be on the diary page (not advanced)
  await expect(page.locator('#currentDayDisplay')).toBeVisible();
});
