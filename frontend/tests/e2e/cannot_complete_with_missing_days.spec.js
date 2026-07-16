const { test, expect } = require('@playwright/test');

test.use({ viewport: { width: 1600, height: 900 } });

async function waitForActivitiesLoaded(page) {
  await expect
    .poll(
      async () => page.locator('#activitiesContainer .activity-button').count(),
      { timeout: 30000, message: 'Waiting for activities to load' }
    )
    .toBeGreaterThan(0);
}

async function navigateThroughInstructions(page) {
  await page.goto('index.html?study_name=default&lang=en', { waitUntil: 'domcontentloaded' });

  await expect(page).toHaveURL(/pages\/instructions\.html/, { timeout: 15000 });
  await expect(page.locator('#continueBtn')).toBeVisible();
  await page.locator('#continueBtn').click();

  await expect(page).toHaveURL(/index\.html/, { timeout: 15000 });
  await waitForActivitiesLoaded(page);
}

async function addActivityAt50Percent(page) {
  await waitForActivitiesLoaded(page);
  await page.locator('#activitiesContainer .activity-button').first().click();

  const activeTimelineContainer = page.locator('.timeline-container[data-active="true"]');
  await expect(activeTimelineContainer).toBeVisible();

  const markerLocator = activeTimelineContainer.locator('.timeline .hour-marker');
  await expect(markerLocator.first()).toBeVisible();

  const closestIndex = await markerLocator.evaluateAll((markers) => {
    let bestIndex = 0;
    let bestDistance = Number.POSITIVE_INFINITY;
    markers.forEach((marker, index) => {
      const styleAttr = marker.getAttribute('style') || '';
      const leftMatch = styleAttr.match(/left\s*:\s*([\d.]+)%/i);
      const leftPercent = leftMatch ? parseFloat(leftMatch[1]) : NaN;
      if (!Number.isNaN(leftPercent)) {
        const distance = Math.abs(leftPercent - 50);
        if (distance < bestDistance) {
          bestDistance = distance;
          bestIndex = index;
        }
      }
    });
    return bestIndex;
  });

  await markerLocator.nth(closestIndex).evaluate((marker) => {
    marker.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, view: window }));
  });

  await page.waitForTimeout(300);
}

async function goToLastTimeline(page) {
  const nextBtn = page.locator('#nextBtn');
  for (let i = 0; i < 10; i++) {
    const isLastTimeline = await page.evaluate(() =>
      window.timelineManager.currentIndex === window.timelineManager.keys.length - 1
    );
    if (isLastTimeline) {
      return;
    }
    // Button might be disabled if no activity placed, click anyway and wait
    await nextBtn.click({ force: true }).catch(() => {});
    await page.waitForTimeout(700);
  }
}

test('button shows Save Day mode on last day when previous days are missing', async ({ page }) => {
  await navigateThroughInstructions(page);

  // Get PID from URL
  const currentUrl = new URL(page.url());
  const pid = currentUrl.searchParams.get('pid');
  expect(pid).toBeTruthy();

  // Navigate directly to the last day (Sunday, index 6) without filling previous days
  const lastDayUrl = `index.html?study_name=default&lang=en&pid=${pid}&day_label_index=6`;

  // Intercept navigation to log what's happening
  page.on('framenavigated', (frame) => {
    console.log('Navigated to:', frame.url());
  });

  await page.goto(lastDayUrl, { waitUntil: 'domcontentloaded' });

  // Wait for navigation to settle
  await page.waitForTimeout(2000);
  console.log('Current URL after navigation:', page.url());

  // If redirected to instructions, go through them again
  if (page.url().includes('instructions.html')) {
    await expect(page.locator('#continueBtn')).toBeVisible({ timeout: 10000 });
    await page.locator('#continueBtn').click();
    await page.waitForURL(/index\.html/, { timeout: 15000 });
    await page.waitForTimeout(2000);
  }

  // Wait for activities to load
  await waitForActivitiesLoaded(page);

  // Add an activity to enable navigation between timelines
  await addActivityAt50Percent(page);

  // Go to last timeline of the day
  await goToLastTimeline(page);
  await page.waitForTimeout(500);

  // Go to last timeline of the day
  await goToLastTimeline(page);
  await page.waitForTimeout(500);

  // Check the submit button mode
  const nextBtn = page.locator('#nextBtn');
  await expect(nextBtn).toBeVisible();

  const buttonMode = await nextBtn.getAttribute('data-mode');

  // Should NOT be finish-study since previous days are missing
  expect(buttonMode).not.toBe('finish-study');

  // Should be save-day mode (last day with incomplete previous days)
  expect(buttonMode).toBe('save-day');
});

test('button shows submit-day mode on non-last study days (last timeline)', async ({ page }) => {
  await navigateThroughInstructions(page);

  // Add an activity to enable the submit button
  await addActivityAt50Percent(page);

  // We should be on day 0 (Monday)
  const currentDayDisplay = page.locator('#currentDayDisplay');
  await expect(currentDayDisplay).toHaveAttribute('title', /Monday/i);

  // Go to last timeline of the day
  await goToLastTimeline(page);
  await page.waitForTimeout(500);

  // Check the submit button mode
  const nextBtn = page.locator('#nextBtn');
  await expect(nextBtn).toBeEnabled();

  const buttonMode = await nextBtn.getAttribute('data-mode');

  // Should be submit-day mode (non-last study day, last timeline)
  expect(buttonMode).toBe('submit-day');
});
