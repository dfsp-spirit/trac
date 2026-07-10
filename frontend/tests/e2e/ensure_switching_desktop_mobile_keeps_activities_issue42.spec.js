const { test, expect } = require('@playwright/test');

const DESKTOP_VIEWPORT = { width: 1600, height: 900 };
const MOBILE_VIEWPORT = { width: 390, height: 844 };

test.use({ viewport: DESKTOP_VIEWPORT });

async function waitForActiveTimelineLayout(page, expectedLayout) {
  await expect
    .poll(
      async () =>
        page
          .locator('.timeline-container[data-active="true"] .timeline')
          .first()
          .getAttribute('data-layout'),
      {
        timeout: 30000,
        message: `Waiting for active timeline layout=${expectedLayout}`,
      }
    )
    .toBe(expectedLayout);
}

async function expectSleepingInActiveTimeline(page) {
  await expect
    .poll(
      async () =>
        page
          .locator('.timeline-container[data-active="true"] .activity-block')
          .filter({ hasText: 'Sleeping' })
          .count(),
      { timeout: 30000, message: 'Expect Sleeping activity in active timeline' }
    )
    .toBeGreaterThan(0);
}

async function waitForActivitiesLoaded(page) {
  await expect
    .poll(async () => page.locator('.activity-button').count(), {
      timeout: 30000,
      message: 'Waiting for activities to load from backend',
    })
    .toBeGreaterThan(0);
}

async function ensureSleepingActivityAvailable(page) {
  await waitForActivitiesLoaded(page);

  let sleepingCount = await page
    .locator('.activity-button[data-code="1101"]')
    .count();
  if (sleepingCount > 0) {
    return;
  }

  const mainActivityTimeline = page
    .locator('.past-initialized-timelines-wrapper .timeline-container')
    .filter({ hasText: 'Main Activity' })
    .first();

  if (await mainActivityTimeline.count()) {
    await mainActivityTimeline.click();
  }

  await expect
    .poll(
      async () => page.locator('.activity-button[data-code="1101"]').count(),
      {
        timeout: 15000,
        message:
          'Waiting for Sleeping activity button (code 1101) after timeline switch',
      }
    )
    .toBeGreaterThan(0);
}

async function clickHourMarkerClosestTo50PercentDesktop(page) {
  const activeTimelineContainer = page.locator(
    '.timeline-container[data-active="true"]'
  );
  await expect(activeTimelineContainer).toBeVisible();

  const markerLocator = activeTimelineContainer.locator(
    '.timeline .hour-marker'
  );
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
    marker.dispatchEvent(
      new MouseEvent('click', {
        bubbles: true,
        cancelable: true,
        view: window,
      })
    );
  });
}

async function addSleepingOnDesktopTimeline(page) {
  await ensureSleepingActivityAvailable(page);

  const sleepingButton = page.locator(
    '#activitiesContainer .activity-button[data-code="1101"]'
  );

  if (await sleepingButton.count()) {
    await sleepingButton.first().click();
  } else {
    const sleepingByText = page
      .locator('#activitiesContainer .activity-button')
      .filter({ hasText: 'Sleeping' })
      .first();
    await expect(sleepingByText).toBeVisible();
    await sleepingByText.click();
  }

  await clickHourMarkerClosestTo50PercentDesktop(page);
}

test('issue42: switching desktop/mobile keeps added activity', async ({
  page,
}) => {
  await page.goto('index.html?study_name=default&lang=en', {
    waitUntil: 'domcontentloaded',
  });

  await expect(page).toHaveURL(/pages\/instructions\.html/);
  await expect(page.locator('#continueBtn')).toBeVisible();
  await page.locator('#continueBtn').click();

  await page.waitForURL(/index\.html/, { timeout: 15000 });

  const currentDayDisplay = page.locator('#currentDayDisplay');
  await expect(currentDayDisplay).toHaveAttribute('title', /Monday/);

  await addSleepingOnDesktopTimeline(page);
  await waitForActiveTimelineLayout(page, 'horizontal');
  await expectSleepingInActiveTimeline(page);

  const primaryActivitiesDesktopBeforeResize = page.locator(
    '#primary .activities'
  );
  await expect(primaryActivitiesDesktopBeforeResize).toContainText('Sleeping', {
    timeout: 30000,
  });

  await page.setViewportSize(MOBILE_VIEWPORT);
  await page.waitForTimeout(1200);
  await expect(page).toHaveURL(/index\.html/);
  await waitForActiveTimelineLayout(page, 'vertical');
  await expectSleepingInActiveTimeline(page);

  const primaryActivitiesMobile = page.locator('#primary .activities');
  await expect(primaryActivitiesMobile).toContainText('Sleeping', {
    timeout: 30000,
  });

  await page.setViewportSize(DESKTOP_VIEWPORT);
  await page.waitForTimeout(1200);
  await expect(page).toHaveURL(/index\.html/);
  await waitForActiveTimelineLayout(page, 'horizontal');
  await expectSleepingInActiveTimeline(page);

  const primaryActivitiesDesktopAfterResize = page.locator(
    '#primary .activities'
  );
  await expect(primaryActivitiesDesktopAfterResize).toContainText('Sleeping', {
    timeout: 30000,
  });
});
