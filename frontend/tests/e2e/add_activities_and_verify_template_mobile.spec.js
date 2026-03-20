const { test, expect } = require('@playwright/test');

const MOBILE_VIEWPORT = { width: 390, height: 844 };

test.use({ viewport: MOBILE_VIEWPORT });

async function waitForActiveTimelineLayout(page, expectedLayout) {
  await expect
    .poll(
      async () => page.locator('.timeline-container[data-active="true"] .timeline').first().getAttribute('data-layout'),
      { timeout: 30000, message: `Waiting for active timeline layout=${expectedLayout}` }
    )
    .toBe(expectedLayout);
}

async function waitForActivitiesLoaded(page) {
  await expect
    .poll(async () => page.locator('.activity-button').count(), {
      timeout: 30000,
      message: 'Waiting for activities to load from backend',
    })
    .toBeGreaterThan(0);
}

async function openActivitiesModal(page) {
  const addButton = page.locator('.floating-add-button');
  await expect(addButton).toBeVisible({ timeout: 30000 });
  await addButton.click();
  await expect(page.locator('#activitiesModal')).toBeVisible();
  await expect(page.locator('#modalActivitiesContainer')).toBeVisible();
}

async function expandGeneralActivitiesInModal(page) {
  const generalHeading = page
    .locator('#modalActivitiesContainer .activity-category h3')
    .filter({ hasText: 'General Activities' })
    .first();

  if (await generalHeading.count()) {
    await generalHeading.click();
  }
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
    // Fall through: in some mobile flows the app auto-closes the modal shortly
    // after selection, but if it does not, close it explicitly.
  }

  const closeButton = page.locator('#activitiesModal .modal-close').first();
  if (await closeButton.isVisible()) {
    await closeButton.click({ force: true });
  }

  await expect(modal).toBeHidden({ timeout: 10000 });
}

async function ensureSleepingActivityAvailable(page) {
  await waitForActivitiesLoaded(page);
  await openActivitiesModal(page);
  await expandGeneralActivitiesInModal(page);

  const sleepingByCode = page.locator('#modalActivitiesContainer .activity-button[data-code="1101"]');
  if (await sleepingByCode.count()) {
    return;
  }

  const mainActivityTimeline = page
    .locator('.past-initialized-timelines-wrapper .timeline-container')
    .filter({ hasText: 'Main Activity' })
    .first();

  if (await mainActivityTimeline.count()) {
    await mainActivityTimeline.click();
  }

  await closeActivitiesModal(page);
  await openActivitiesModal(page);
  await expandGeneralActivitiesInModal(page);

  await expect
    .poll(async () => page.locator('#modalActivitiesContainer .activity-button[data-code="1101"]').count(), {
      timeout: 15000,
      message: 'Waiting for Sleeping activity button (code 1101) in mobile modal',
    })
    .toBeGreaterThan(0);
}

async function selectSleepingActivity(page) {
  await ensureSleepingActivityAvailable(page);

  const sleepingByCode = page.locator('#modalActivitiesContainer .activity-button[data-code="1101"]');
  if (await sleepingByCode.count()) {
    await sleepingByCode.first().evaluate((button) => button.click());
    await closeActivitiesModal(page);
    return;
  }

  const sleepingByText = page
    .locator('#modalActivitiesContainer .activity-button')
    .filter({ hasText: 'Sleeping' })
    .first();
  await expect(sleepingByText).toHaveCount(1);
  await sleepingByText.evaluate((button) => button.click());
  await closeActivitiesModal(page);
}

async function placeAnyActivityOnActiveTimeline(page) {
  await waitForActivitiesLoaded(page);
  await openActivitiesModal(page);

  const firstVisibleActivity = page
    .locator('#modalActivitiesContainer .activity-button')
    .first();
  await expect(firstVisibleActivity).toHaveCount(1);
  await firstVisibleActivity.evaluate((button) => button.click());
  await closeActivitiesModal(page);

  await clickHourMarkerClosestTo50PercentMobile(page);
}

async function clickHourMarkerClosestTo50PercentMobile(page) {
  const activeTimelineContainer = page.locator('.timeline-container[data-active="true"]');
  await expect(activeTimelineContainer).toBeVisible();

  const markerLocator = activeTimelineContainer.locator('.timeline .hour-marker');
  await expect(markerLocator.first()).toBeVisible();

  const markerCount = await markerLocator.count();
  expect(markerCount).toBeGreaterThan(0);

  const closestIndex = await markerLocator.evaluateAll((markers) => {
    let bestIndex = 0;
    let bestDistance = Number.POSITIVE_INFINITY;

    markers.forEach((marker, index) => {
      const styleAttr = marker.getAttribute('style') || '';
      const topMatch = styleAttr.match(/top\s*:\s*([\d.]+)%/i);
      const topPercent = topMatch ? parseFloat(topMatch[1]) : NaN;
      if (!Number.isNaN(topPercent)) {
        const distance = Math.abs(topPercent - 50);
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

async function placeSleepingOnActiveTimeline(page) {
  await selectSleepingActivity(page);
  await clickHourMarkerClosestTo50PercentMobile(page);
}

test('mobile: instructions -> add Sleeping at ~50% -> next timeline/day shows Tuesday and template', async ({ page }) => {
  await page.goto('index.html?study_name=default&lang=en', { waitUntil: 'domcontentloaded' });

  await expect(page).toHaveURL(/pages\/instructions\.html/);
  await expect(page.locator('#continueBtn')).toBeVisible();
  await page.locator('#continueBtn').click();

  await expect(page).toHaveURL(/index\.html/);
  await waitForActiveTimelineLayout(page, 'vertical');

  const currentDayDisplay = page.locator('#currentDayDisplay');
  await expect(currentDayDisplay).toHaveAttribute('title', /Monday/);

  await placeSleepingOnActiveTimeline(page);

  const nextBtn = page.locator('#nextBtn');
  await expect(nextBtn).toBeVisible();
  await expect(nextBtn).toBeEnabled();
  await nextBtn.click();

  const dayTitleAfterFirstNext = (await currentDayDisplay.getAttribute('title')) || '';

  if (!dayTitleAfterFirstNext.includes('Tuesday')) {
    await placeAnyActivityOnActiveTimeline(page);
    await expect(nextBtn).toBeEnabled();
    await page.waitForTimeout(700);

    const confirmationModal = page.locator('#confirmationModal');
    for (let attempt = 0; attempt < 3; attempt += 1) {
      await nextBtn.click();

      if (await confirmationModal.isVisible()) {
        await page.locator('#confirmOk').click();
        break;
      }

      const maybeUpdatedTitle = (await currentDayDisplay.getAttribute('title')) || '';
      if (maybeUpdatedTitle.includes('Tuesday')) {
        break;
      }

      await page.waitForTimeout(700);
    }
  }

  await expect(currentDayDisplay).toHaveAttribute('title', /Tuesday/, { timeout: 30000 });

  const primaryActivitiesContainer = page.locator('#primary .activities');
  await expect(primaryActivitiesContainer).toContainText('Sleeping', { timeout: 30000 });
});
