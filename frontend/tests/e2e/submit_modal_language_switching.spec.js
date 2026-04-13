/**
 * E2E test: submit confirmation modal text updates when the user switches language.
 *
 * Covers the bug where the modal always showed hardcoded English strings regardless
 * of the selected UI language. The test verifies the modal title and submit-button
 * text match the active language for three consecutive days:
 *   Day 1  – English  (lang=en, Monday)
 *   Day 2  – Swedish  (lang=sv, Tuesday – switched via the language selector)
 *   Day 3  – English  (lang=en, Wednesday – switched back)
 */

const { test, expect } = require('@playwright/test');

test.use({ viewport: { width: 1600, height: 900 } });

// ---------------------------------------------------------------------------
// Shared helpers (mirrors patterns from other E2E specs in this directory)
// ---------------------------------------------------------------------------

async function waitForActivitiesLoaded(page) {
  await expect
    .poll(async () => page.locator('#activitiesContainer .activity-button').count(), {
      timeout: 30000,
      message: 'Waiting for activity buttons to load',
    })
    .toBeGreaterThan(0);
}

async function clickHourMarkerAtPercent(page, targetPercent) {
  const activeTimelineContainer = page.locator('.timeline-container[data-active="true"]');
  await expect(activeTimelineContainer).toBeVisible();

  const markerLocator = activeTimelineContainer.locator('.timeline .hour-marker');
  await expect(markerLocator.first()).toBeVisible();

  const closestIndex = await markerLocator.evaluateAll((markers, pct) => {
    let bestIndex = 0;
    let bestDistance = Number.POSITIVE_INFINITY;
    markers.forEach((marker, index) => {
      const style = marker.getAttribute('style') || '';
      const leftMatch = style.match(/left\s*:\s*([\d.]+)%/i);
      if (leftMatch) {
        const distance = Math.abs(parseFloat(leftMatch[1]) - pct);
        if (distance < bestDistance) {
          bestDistance = distance;
          bestIndex = index;
        }
      }
    });
    return bestIndex;
  }, targetPercent);

  await markerLocator.nth(closestIndex).evaluate((marker) => {
    marker.dispatchEvent(
      new MouseEvent('click', { bubbles: true, cancelable: true, view: window })
    );
  });
}

async function placeActivityOnTimeline(page) {
  await waitForActivitiesLoaded(page);
  await page.locator('#activitiesContainer .activity-button:visible').first().click();
  await clickHourMarkerAtPercent(page, 50);
}

async function goToSecondaryTimeline(page) {
  const nextBtn = page.locator('#nextBtn');
  await expect(nextBtn).toBeEnabled();
  await nextBtn.click();
  await expect
    .poll(
      () => page.evaluate(() => window.timelineManager.keys[window.timelineManager.currentIndex]),
      { timeout: 10000, message: 'Waiting to switch to secondary timeline' }
    )
    .toBe('secondary');
}

async function openSubmitConfirmation(page) {
  const nextBtn = page.locator('#nextBtn');
  const confirmationModal = page.locator('#confirmationModal');
  await expect(nextBtn).toBeEnabled();
  for (let attempt = 0; attempt < 4; attempt += 1) {
    await nextBtn.click();
    if (await confirmationModal.isVisible()) {
      return;
    }
    await page.waitForTimeout(700);
  }
  await expect(confirmationModal).toBeVisible();
}

// ---------------------------------------------------------------------------
// Test
// ---------------------------------------------------------------------------

test('submit modal uses correct language for each day after language switch', async ({ page }) => {
  // Stub the POST-activities submit endpoint so the test does not depend on
  // a writable backend. GET calls are left to pass through so study config and
  // activity definitions still load from the real backend.
  await page.route('**/studies/**/participants/**/day_labels/**/activities', async (route) => {
    if (route.request().method() === 'POST') {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ ok: true }),
      });
    } else {
      await route.continue();
    }
  });

  // -------------------------------------------------------------------------
  // Day 1 – English (Monday)
  // -------------------------------------------------------------------------
  await page.goto('index.html?study_name=default&lang=en', { waitUntil: 'domcontentloaded' });
  await expect(page).toHaveURL(/pages\/instructions\.html/);
  await page.locator('#continueBtn').click();
  await expect(page).toHaveURL(/index\.html/);

  await waitForActivitiesLoaded(page);
  await placeActivityOnTimeline(page);
  await goToSecondaryTimeline(page);
  await placeActivityOnTimeline(page);
  await openSubmitConfirmation(page);

  const confirmModal = page.locator('#confirmationModal');
  // Verify the modal title is in English and references Monday (day 1 of 7)
  await expect(confirmModal.locator('h3')).toContainText('Submit data for');
  await expect(confirmModal.locator('h3')).toContainText('Monday');
  // Verify the submit button text is in English
  await expect(confirmModal.locator('#confirmOk')).toContainText('Submit Day');

  // Submit and advance to day 2
  await confirmModal.locator('#confirmOk').click();
  await expect(page.locator('#currentDayDisplay')).toHaveAttribute('title', /Tuesday|Tisdag/, {
    timeout: 30000,
  });

  // -------------------------------------------------------------------------
  // Day 2 – Swedish (Tuesday) – switch language via the language selector
  // -------------------------------------------------------------------------
  await expect(page.locator('#languageSelectMain')).toBeVisible();
  await Promise.all([
    page.waitForURL(/lang=sv/, { timeout: 30000 }),
    page.locator('#languageSelectMain').selectOption('sv'),
  ]);

  // The page reloads in-place with lang=sv; we should land on day 2 directly
  // (no instructions redirect because instructions=completed is already in the URL)
  await expect(page).toHaveURL(/index\.html/);
  await waitForActivitiesLoaded(page);

  await placeActivityOnTimeline(page);
  await goToSecondaryTimeline(page);
  await placeActivityOnTimeline(page);
  await openSubmitConfirmation(page);

  // Verify the modal title is in Swedish and references Tisdag (day 2 of 7)
  await expect(confirmModal.locator('h3')).toContainText('Skicka in data för');
  await expect(confirmModal.locator('h3')).toContainText('Tisdag');
  // Verify the submit button text is in Swedish
  await expect(confirmModal.locator('#confirmOk')).toContainText('Skicka in dag');

  // Submit and advance to day 3
  await confirmModal.locator('#confirmOk').click();
  await expect(page.locator('#currentDayDisplay')).toHaveAttribute('title', /Wednesday|Onsdag/, {
    timeout: 30000,
  });

  // -------------------------------------------------------------------------
  // Day 3 – English again (Wednesday) – switch language back
  // -------------------------------------------------------------------------
  await expect(page.locator('#languageSelectMain')).toBeVisible();
  await Promise.all([
    page.waitForURL(/lang=en/, { timeout: 30000 }),
    page.locator('#languageSelectMain').selectOption('en'),
  ]);

  await expect(page).toHaveURL(/index\.html/);
  await waitForActivitiesLoaded(page);

  await placeActivityOnTimeline(page);
  await goToSecondaryTimeline(page);
  await placeActivityOnTimeline(page);
  await openSubmitConfirmation(page);

  // Verify the modal title is back in English and references Wednesday (day 3 of 7)
  await expect(confirmModal.locator('h3')).toContainText('Submit data for');
  await expect(confirmModal.locator('h3')).toContainText('Wednesday');
  // Verify the submit button text is back in English
  await expect(confirmModal.locator('#confirmOk')).toContainText('Submit Day');
});
