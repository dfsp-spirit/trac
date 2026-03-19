const { test, expect } = require('@playwright/test');

test.use({ viewport: { width: 1600, height: 900 } });

async function waitForActivitiesLoaded(page) {
  await expect
    .poll(async () => page.locator('#activitiesContainer .activity-button').count(), {
      timeout: 30000,
      message: 'Waiting for activity buttons to load',
    })
    .toBeGreaterThan(0);
}

async function clickHourMarkerClosestToPercent(page, targetPercent) {
  const activeTimelineContainer = page.locator('.timeline-container[data-active="true"]');
  await expect(activeTimelineContainer).toBeVisible();

  const markerLocator = activeTimelineContainer.locator('.timeline .hour-marker');
  await expect(markerLocator.first()).toBeVisible();

  const closestIndex = await markerLocator.evaluateAll((markers, percent) => {
    let bestIndex = 0;
    let bestDistance = Number.POSITIVE_INFINITY;

    markers.forEach((marker, index) => {
      const styleAttr = marker.getAttribute('style') || '';
      const leftMatch = styleAttr.match(/left\s*:\s*([\d.]+)%/i);
      const topMatch = styleAttr.match(/top\s*:\s*([\d.]+)%/i);
      const markerPercent = leftMatch ? parseFloat(leftMatch[1]) : topMatch ? parseFloat(topMatch[1]) : NaN;

      if (!Number.isNaN(markerPercent)) {
        const distance = Math.abs(markerPercent - percent);
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

async function selectActivityByCodeOrFirst(page, code) {
  await waitForActivitiesLoaded(page);

  if (code) {
    const byCode = page.locator(`#activitiesContainer .activity-button[data-code="${code}"]`);
    if (await byCode.count()) {
      await byCode.first().click();
      return;
    }
  }

  await page.locator('#activitiesContainer .activity-button:visible').first().click();
}

async function addActivityAtPercent(page, { code, percent }) {
  await selectActivityByCodeOrFirst(page, code);
  await clickHourMarkerClosestToPercent(page, percent);
}

async function goToSecondaryTimeline(page) {
  const nextBtn = page.locator('#nextBtn');
  await expect(nextBtn).toBeVisible();
  await expect(nextBtn).toBeEnabled();
  await nextBtn.click();

  await expect
    .poll(async () => page.evaluate(() => window.timelineManager.keys[window.timelineManager.currentIndex]), {
      timeout: 10000,
      message: 'Waiting to switch to secondary timeline',
    })
    .toBe('secondary');
}

async function submitCurrentDay(page, expectedNextDayName) {
  const nextBtn = page.locator('#nextBtn');
  const confirmationModal = page.locator('#confirmationModal');
  const currentDayDisplay = page.locator('#currentDayDisplay');

  await expect(nextBtn).toBeVisible();
  await expect(nextBtn).toBeEnabled();

  for (let attempt = 0; attempt < 4; attempt += 1) {
    await nextBtn.click();

    if (await confirmationModal.isVisible()) {
      await page.locator('#confirmOk').click();
      break;
    }

    const title = (await currentDayDisplay.getAttribute('title')) || '';
    if (title.includes(expectedNextDayName)) {
      break;
    }

    await page.waitForTimeout(700);
  }

  await expect(currentDayDisplay).toHaveAttribute('title', new RegExp(expectedNextDayName), {
    timeout: 30000,
  });
}

test('day2 template keeps both timelines populated and separated', async ({ page }) => {
  await page.goto('index.html?study_name=default&lang=en', { waitUntil: 'domcontentloaded' });

  await expect(page).toHaveURL(/pages\/instructions\.html/);
  await expect(page.locator('#continueBtn')).toBeVisible();
  await page.locator('#continueBtn').click();
  await expect(page).toHaveURL(/index\.html/);

  await expect(page.locator('#currentDayDisplay')).toHaveAttribute('title', /Monday/);

  await addActivityAtPercent(page, { code: 1101, percent: 70 });

  await goToSecondaryTimeline(page);
  await addActivityAtPercent(page, { code: null, percent: 10 });

  await submitCurrentDay(page, 'Tuesday');

  await expect
    .poll(async () => page.locator('.timeline-container').count(), {
      timeout: 30000,
      message: 'Waiting for both timelines on day 2',
    })
    .toBe(2);

  const day2State = await page.evaluate(() => {
    const data = window.timelineManager.activities;
    const primary = data.primary || [];
    const secondary = data.secondary || [];

    return {
      primaryCount: primary.length,
      secondaryCount: secondary.length,
      primaryIntegrity: primary.every((a) => a.timelineKey === 'primary'),
      secondaryIntegrity: secondary.every((a) => a.timelineKey === 'secondary'),
    };
  });

  expect(day2State.primaryCount).toBeGreaterThan(0);
  expect(day2State.secondaryCount).toBeGreaterThan(0);
  expect(day2State.primaryIntegrity).toBeTruthy();
  expect(day2State.secondaryIntegrity).toBeTruthy();

  await goToSecondaryTimeline(page);

  await expect
    .poll(async () => {
      return page.evaluate(() => {
        const key = window.timelineManager.keys[window.timelineManager.currentIndex];
        const timelineEl = document.getElementById(key);
        const visibleBlocks = timelineEl ? timelineEl.querySelectorAll('.activity-block').length : 0;
        const dataBlocks = (window.timelineManager.activities[key] || []).length;
        return { key, visibleBlocks, dataBlocks };
      });
    }, {
      timeout: 10000,
      message: 'Secondary timeline should keep template activities visible and in state',
    })
    .toMatchObject({ key: 'secondary' });

  const secondaryState = await page.evaluate(() => {
    const key = window.timelineManager.keys[window.timelineManager.currentIndex];
    const timelineEl = document.getElementById(key);
    return {
      key,
      visibleBlocks: timelineEl ? timelineEl.querySelectorAll('.activity-block').length : 0,
      dataBlocks: (window.timelineManager.activities[key] || []).length,
    };
  });

  expect(secondaryState.visibleBlocks).toBeGreaterThan(0);
  expect(secondaryState.dataBlocks).toBeGreaterThan(0);
});
