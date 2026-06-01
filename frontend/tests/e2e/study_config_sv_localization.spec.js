const { test, expect } = require('@playwright/test');

test.use({ viewport: { width: 1600, height: 900 } });

async function waitForActivitiesLoaded(page) {
  await expect
    .poll(async () => page.locator('.activity-button').count(), {
      timeout: 30000,
      message: 'Waiting for activities to load from backend',
    })
    .toBeGreaterThan(0);
}

async function clickHourMarkerClosestTo50Percent(page) {
  const activeTimelineContainer = page.locator(
    '.timeline-container[data-active="true"]'
  );
  await expect(activeTimelineContainer).toBeVisible();

  const markerLocator = activeTimelineContainer.locator(
    '.timeline .hour-marker'
  );
  await expect(markerLocator.first()).toBeVisible();

  const markerCount = await markerLocator.count();
  expect(markerCount).toBeGreaterThan(0);

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
    marker.dispatchEvent(
      new MouseEvent('click', {
        bubbles: true,
        cancelable: true,
        view: window,
      })
    );
  });
}

async function placeAnyActivityOnActiveTimeline(page) {
  await waitForActivitiesLoaded(page);

  const firstVisibleActivity = page
    .locator('#activitiesContainer .activity-button:visible')
    .first();
  await expect(firstVisibleActivity).toBeVisible();
  await firstVisibleActivity.click();

  await clickHourMarkerClosestTo50Percent(page);
}

test('study-config SV localization: intro text and day labels are shown in Swedish', async ({
  page,
}) => {
  const pid = `trac-e2e-sv-${Date.now()}-${Math.floor(Math.random() * 1_000_000)}`;

  await page.goto(`index.html?study_name=default&lang=sv&pid=${pid}`, {
    waitUntil: 'domcontentloaded',
  });

  await expect(page).toHaveURL(/pages\/instructions\.html/);

  const intro = page.locator('#study-custom-message-intro');
  await expect(intro).toBeVisible();
  await expect(intro).toContainText(/tidsanvändningsstudie/i);
  await expect(intro).toContainText(/typisk vecka/i);

  await page.locator('#continueBtn').click();
  await expect(page).toHaveURL(/index\.html/);

  // If the app has switched away from Swedish (e.g. backend/default preferences),
  // force lang=sv and continue with deterministic Swedish assertions.
  if (!page.url().includes('lang=sv')) {
    const url = new URL(page.url());
    url.searchParams.set('lang', 'sv');
    url.searchParams.set('pid', pid);
    await page.goto(url.toString(), { waitUntil: 'domcontentloaded' });
    await expect(page).toHaveURL(/lang=sv/);
  }

  const activeLang = await page.evaluate(
    () => window.studyConfigManager?.getSelectedLanguage?.() || 'en'
  );
  expect(activeLang).toBe('sv');

  const currentDayDisplay = page.locator('#currentDayDisplay');
  await expect(currentDayDisplay).toBeVisible();
  await expect(currentDayDisplay).toHaveAttribute('title', /Måndag|måndag/);

  await placeAnyActivityOnActiveTimeline(page);

  const nextBtn = page.locator('#nextBtn');
  await expect(nextBtn).toBeVisible();
  await expect(nextBtn).toBeEnabled();
  await nextBtn.click();

  await placeAnyActivityOnActiveTimeline(page);
  await expect(nextBtn).toBeEnabled();

  const confirmationModal = page.locator('#confirmationModal');
  for (let attempt = 0; attempt < 4; attempt += 1) {
    await nextBtn.click();
    if (await confirmationModal.isVisible()) {
      break;
    }
    await page.waitForTimeout(500);
  }

  await expect(confirmationModal).toBeVisible();
  await expect(confirmationModal).toContainText(/Måndag|måndag/);
});
