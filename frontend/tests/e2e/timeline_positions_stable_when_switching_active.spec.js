const { test, expect } = require('@playwright/test');

test.use({ viewport: { width: 1600, height: 900 } });

async function clickHourMarkerClosestTo50Percent(page) {
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

async function addSleepingToMainTimeline(page) {
  const sleepingButton = page.locator(
    '#activitiesContainer .activity-button[data-code="1101"]'
  );
  await expect(sleepingButton.first()).toBeVisible({ timeout: 30000 });
  await sleepingButton.first().click();
  await clickHourMarkerClosestTo50Percent(page);
}

async function getTimelineTopByTitle(page, titleText) {
  const timelineContainer = page
    .locator('.timeline-container')
    .filter({ hasText: titleText })
    .first();
  await expect(timelineContainer).toBeVisible();
  const docTop = await timelineContainer.evaluate((element) => {
    const rect = element.getBoundingClientRect();
    return rect.top + window.scrollY;
  });
  expect(docTop).not.toBeNull();
  return docTop;
}

test('desktop timeline positions stay stable when active timeline changes', async ({
  page,
}) => {
  await page.goto('index.html?study_name=default&lang=en', {
    waitUntil: 'domcontentloaded',
  });

  await expect(page).toHaveURL(/pages\/instructions\.html/);
  await page.locator('#continueBtn').click();
  await page.waitForURL(/index\.html/, { timeout: 15000 });

  await expect(page.locator('.timeline-title')).toContainText('Monday');
  await expect(page.locator('.timeline-title')).toContainText('Day 1 of 7');

  await addSleepingToMainTimeline(page);

  const mainTopBefore = await getTimelineTopByTitle(page, 'Main Activity');

  await page.locator('#nextBtn').click();
  await expect
    .poll(
      () =>
        page.evaluate(
          () => window.timelineManager.keys[window.timelineManager.currentIndex]
        ),
      { timeout: 10000, message: 'Waiting to switch to secondary timeline' }
    )
    .toBe('secondary');

  const mainTopAfterNext = await getTimelineTopByTitle(page, 'Main Activity');

  const pastMainTimeline = page
    .locator('.past-initialized-timelines-wrapper .timeline-container')
    .filter({ hasText: 'Main Activity' })
    .first();
  await expect(pastMainTimeline).toBeVisible();
  await pastMainTimeline.click();

  await expect
    .poll(
      () =>
        page.evaluate(
          () => window.timelineManager.keys[window.timelineManager.currentIndex]
        ),
      { timeout: 10000, message: 'Waiting to switch back to primary timeline' }
    )
    .toBe('primary');

  const mainTopAfterClickBack = await getTimelineTopByTitle(
    page,
    'Main Activity'
  );

  expect(Math.abs(mainTopAfterNext - mainTopBefore)).toBeLessThanOrEqual(3);
  expect(Math.abs(mainTopAfterClickBack - mainTopBefore)).toBeLessThanOrEqual(
    3
  );
});
