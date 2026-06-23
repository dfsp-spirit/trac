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

async function selectActivityFromModal(page, options) {
  await openActivitiesModal(page);

  if (options.code) {
    const byCode = page.locator(
      `#modalActivitiesContainer .activity-button[data-code="${options.code}"]`
    );
    if (await byCode.count()) {
      await byCode.first().evaluate((button) => button.click());
      await closeActivitiesModal(page);
      return;
    }
  }

  const byText = page
    .locator('#modalActivitiesContainer .activity-button')
    .filter({ hasText: options.text })
    .first();

  await expect(byText).toHaveCount(1);
  await byText.evaluate((button) => button.click());
  await closeActivitiesModal(page);
}

async function addActivityAt50Mobile(page, options) {
  await selectActivityFromModal(page, options);
  await clickHourMarkerClosestToPercentMobile(page, 50);
}

async function goToSecondaryTimeline(page) {
  const nextBtn = page.locator('#nextBtn');
  await expect(nextBtn).toBeVisible();
  await expect(nextBtn).toBeEnabled();

  for (let attempt = 0; attempt < 4; attempt += 1) {
    await nextBtn.click();
    await page.waitForTimeout(700);

    const activeTimelineKey = await page.evaluate(
      () => window.timelineManager.keys[window.timelineManager.currentIndex]
    );
    if (activeTimelineKey === 'secondary') {
      return;
    }
  }

  await expect
    .poll(
      () =>
        page.evaluate(
          () => window.timelineManager.keys[window.timelineManager.currentIndex]
        ),
      { timeout: 10000, message: 'Waiting to switch to secondary timeline' }
    )
    .toBe('secondary');
}

async function submitCurrentDay(page, expectedNextDayName) {
  const nextBtn = page.locator('#nextBtn');
  const confirmationModal = page.locator('#confirmationModal');
  const currentDayDisplay = page.locator('#currentDayDisplay');

  await expect(nextBtn).toBeVisible();
  await expect(nextBtn).toBeEnabled();
  for (let attempt = 0; attempt < 3; attempt += 1) {
    await nextBtn.click();

    if (await confirmationModal.isVisible()) {
      await page.locator('#confirmOk').click();
      break;
    }

    const maybeUpdatedTitle =
      (await currentDayDisplay.getAttribute('title')) || '';
    if (maybeUpdatedTitle.includes(expectedNextDayName)) {
      break;
    }

    await page.waitForTimeout(700);
  }

  await expect(currentDayDisplay).toHaveAttribute(
    'title',
    new RegExp(expectedNextDayName),
    {
      timeout: 30000,
    }
  );
}

async function expectTwoTimelinesAndTemplateActivities(page) {
  await expect
    .poll(async () => page.locator('.timeline-container').count(), {
      timeout: 30000,
      message: 'Waiting for both timelines to be present',
    })
    .toBe(2);

  await expect(
    page.locator('.activity-block').filter({ hasText: 'Sleeping' }).first()
  ).toBeVisible({ timeout: 30000 });
  await expect(
    page
      .locator('.activity-block')
      .filter({ hasText: 'Listening to Audio' })
      .first()
  ).toBeVisible({ timeout: 30000 });
}

test('mobile: templates keep both timelines and activities on Tuesday and Wednesday', async ({
  page,
}) => {
  await page.goto('index.html?study_name=default&lang=en', {
    waitUntil: 'domcontentloaded',
  });

  await expect(page).toHaveURL(/pages\/instructions\.html/);
  await expect(page.locator('#continueBtn')).toBeVisible();
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

  await expect(page.locator('#currentDayDisplay')).toHaveAttribute(
    'title',
    /Monday/
  );

  await addActivityAt50Mobile(page, { code: 1101, text: 'Sleeping' });

  await goToSecondaryTimeline(page);
  await addActivityAt50Mobile(page, { text: 'Listening to Audio' });

  await submitCurrentDay(page, 'Tuesday');
  await expectTwoTimelinesAndTemplateActivities(page);

  await goToSecondaryTimeline(page);
  await submitCurrentDay(page, 'Wednesday');

  await expect(page.locator('#currentDayDisplay')).toHaveAttribute(
    'title',
    /Wednesday/,
    {
      timeout: 30000,
    }
  );
  await expectTwoTimelinesAndTemplateActivities(page);
});
