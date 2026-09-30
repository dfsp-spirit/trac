const { test, expect } = require('@playwright/test');
const {
  enterStudyIfNeeded,
  placeActivity,
  saveCurrentDay,
} = require('./e2e_helpers.js');

test.use({ viewport: { width: 1600, height: 900 } });

test('failed save auto-retries and stays on current day', async ({ page }) => {
  let firstAttemptFailed = false;

  await page.route('**/*activities**', async (route, request) => {
    // Only intercept POST (save activities), not GET (activities-config)
    if (request.method() !== 'POST') {
      await route.continue();
      return;
    }

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
  });

  await page.goto('index.html?study_name=default&lang=en', {
    waitUntil: 'domcontentloaded',
  });

  await enterStudyIfNeeded(page);

  // Place an activity on the primary timeline (always visible now)
  await placeActivity(page, { activityName: 'Sleeping', positionPercent: 70 });

  // Save — first attempt fails (500), the retry succeeds (200).
  // Don't re-enter the study afterwards (saveCurrentDay with reenter:false).
  await saveCurrentDay(page, { reenter: false });

  // Verify the first attempt did fail (retry was triggered)
  expect(firstAttemptFailed).toBe(true);

  // The save never navigates: we stay on the diary day we were on.
  await expect(page.locator('#currentDayDisplay')).toBeVisible();
});
