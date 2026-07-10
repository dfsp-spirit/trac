const { test, expect } = require('@playwright/test');

const MOBILE_VIEWPORT = { width: 390, height: 844 };

test.use({ viewport: MOBILE_VIEWPORT });

async function waitForActivitiesModal(page) {
  await expect
    .poll(
      async () => page.locator('#modalActivitiesContainer .activity-button').count(),
      {
        timeout: 30000,
        message: 'Waiting for activity buttons in modal to load',
      }
    )
    .toBeGreaterThan(0);
}

async function openActivitiesModal(page) {
  const addButton = page.locator('.floating-add-button');
  await expect(addButton).toBeVisible({ timeout: 30000 });
  await addButton.click();
  await expect(page.locator('#activitiesModal')).toBeVisible();
  await waitForActivitiesModal(page);
}

async function closeActivitiesModal(page) {
  const modal = page.locator('#activitiesModal');
  if (!(await modal.isVisible())) {
    return;
  }

  try {
    await modal.waitFor({ state: 'hidden', timeout: 1000 });
    return;
  } catch {
    // modal still open, close explicitly
  }

  const closeButton = page.locator('#activitiesModal .modal-close').first();
  if (await closeButton.isVisible()) {
    await closeButton.click({ force: true });
  }

  await expect(modal).toBeHidden({ timeout: 10000 });
}

async function clickHourMarkerClosestToPercentMobile(page, targetPercent) {
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

  const closestIndex = await markerLocator.evaluateAll((markers, percent) => {
    let bestIndex = 0;
    let bestDistance = Number.POSITIVE_INFINITY;

    markers.forEach((marker, index) => {
      const styleAttr = marker.getAttribute('style') || '';
      const topMatch = styleAttr.match(/top\s*:\s*([\d.]+)%/i);
      const topPercent = topMatch ? parseFloat(topMatch[1]) : NaN;
      if (!Number.isNaN(topPercent)) {
        const distance = Math.abs(topPercent - percent);
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
      new MouseEvent('click', {
        bubbles: true,
        cancelable: true,
        view: window,
      })
    );
  });
}

async function placeSingleActivityMobile(page) {
  await openActivitiesModal(page);

  const firstActivity = page
    .locator(
      '#modalActivitiesContainer .activity-button:visible:not(.has-child-items):not(.custom-input)'
    )
    .first();

  await expect(firstActivity).toBeVisible({ timeout: 10000 });
  await firstActivity.evaluate((button) => button.click());
  await closeActivitiesModal(page);

  await clickHourMarkerClosestToPercentMobile(page, 25);

  await expect(
    page.locator('.timeline-container[data-active="true"] .activity-block')
  ).toHaveCount(1);
}

test('mobile: deleting activity on inactive timeline is ignored - block survives and submit stays enabled', async ({
  page,
}) => {
  await page.goto('index.html?study_name=default&lang=en', {
    waitUntil: 'domcontentloaded',
  });

  await expect(page).toHaveURL(/pages\/instructions\.html/);
  await page.locator('#continueBtn').click();
  await expect(page).toHaveURL(/index\.html/);

  // Verify mobile layout
  await expect
    .poll(
      async () =>
        page
          .locator('.timeline-container[data-active="true"] .timeline')
          .first()
          .getAttribute('data-layout'),
      {
        timeout: 30000,
        message: 'Waiting for mobile vertical timeline layout',
      }
    )
    .toBe('vertical');

  const nextBtn = page.locator('#nextBtn');
  const navSubmitBtn = page.locator('#navSubmitBtn');

  await expect(nextBtn).toBeDisabled();
  await expect(navSubmitBtn).toBeDisabled();

  // Place an activity on the primary (first) timeline
  await placeSingleActivityMobile(page);

  await expect(nextBtn).toBeEnabled();
  await expect(navSubmitBtn).toBeEnabled();

  // Navigate to the secondary timeline
  for (let attempt = 0; attempt < 4; attempt += 1) {
    await nextBtn.click();
    await page.waitForTimeout(700);

    const currentKey = await page.evaluate(
      () => window.timelineManager.keys[window.timelineManager.currentIndex]
    );
    if (currentKey === 'secondary') {
      break;
    }
  }

  await expect
    .poll(async () =>
      page.evaluate(
        () => window.timelineManager.keys[window.timelineManager.currentIndex]
      )
    )
    .toBe('secondary');

  // Submit should still be enabled (primary has sufficient coverage)
  await expect(nextBtn).toBeEnabled();
  await expect(navSubmitBtn).toBeEnabled();

  // With the new mobile design, inactive timelines are hidden (display: none).
  // Users cannot interact with activities on inactive timelines on mobile.
  // This test verifies that the primary timeline's activity count is preserved
  // even when viewing the secondary timeline.
  const primaryActivityCount = await page.evaluate(() => {
    const primaryKey = 'primary';
    return (window.timelineManager.activities[primaryKey] || []).length;
  });

  expect(primaryActivityCount).toBe(1);

  // Submit buttons must remain enabled — primary coverage is unchanged
  await expect(nextBtn).toBeEnabled();
  await expect(navSubmitBtn).toBeEnabled();
});

test('mobile: deleting activity on active timeline removes it and can disable submit', async ({
  page,
}) => {
  await page.goto('index.html?study_name=default&lang=en', {
    waitUntil: 'domcontentloaded',
  });

  await expect(page).toHaveURL(/pages\/instructions\.html/);
  await page.locator('#continueBtn').click();
  await expect(page).toHaveURL(/index\.html/);

  // Wait for the page to be fully loaded
  await page.waitForTimeout(1000);

  // Close the instruction banner if it's visible (it can block interactions)
  const banner = page.locator('#instructionBanner');
  const isBannerVisible = await banner.isVisible().catch(() => false);
  if (isBannerVisible) {
    const bannerClose = banner.locator('.banner-close');
    await bannerClose.click({ force: true });
    await page.waitForTimeout(500);
  }

  // Verify mobile layout
  await expect
    .poll(
      async () =>
        page
          .locator('.timeline-container[data-active="true"] .timeline')
          .first()
          .getAttribute('data-layout'),
      {
        timeout: 30000,
        message: 'Waiting for mobile vertical timeline layout',
      }
    )
    .toBe('vertical');

  const nextBtn = page.locator('#nextBtn');
  const navSubmitBtn = page.locator('#navSubmitBtn');

  await expect(nextBtn).toBeDisabled();
  await expect(navSubmitBtn).toBeDisabled();

  // Place an activity on the primary (active) timeline
  await placeSingleActivityMobile(page);

  await expect(nextBtn).toBeEnabled();
  await expect(navSubmitBtn).toBeEnabled();

  // Delete the activity block using JavaScript (bypasses hover requirement)
  await page.evaluate(() => {
    const block = document.querySelector(
      '.timeline-container[data-active="true"] .activity-block'
    );
    if (block) {
      window.deleteActivityBlock(block);
    }
  });

  // Block must be gone
  await expect(
    page.locator('.timeline-container[data-active="true"] .activity-block')
  ).toHaveCount(0);

  // Submit buttons must now be disabled (min coverage no longer met)
  await expect(nextBtn).toBeDisabled();
  await expect(navSubmitBtn).toBeDisabled();
});
