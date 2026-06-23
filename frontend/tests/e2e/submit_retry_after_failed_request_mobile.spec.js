const { test, expect } = require('@playwright/test');
const { enterStudyIfNeeded } = require('./e2e_helpers.js');

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

async function selectActivityFromModalByCodeOrFirst(page, code) {
  await openActivitiesModal(page);

  if (code) {
    const byCode = page.locator(
      `#modalActivitiesContainer .activity-button[data-code="${code}"]`
    );
    if (await byCode.count()) {
      await byCode.first().evaluate((button) => button.click());
      await closeActivitiesModal(page);
      return;
    }
  }

  const firstVisible = page
    .locator('#modalActivitiesContainer .activity-button:visible')
    .first();
  await expect(firstVisible).toHaveCount(1);
  await firstVisible.evaluate((button) => button.click());
  await closeActivitiesModal(page);
}

async function addActivityAtPercentMobile(page, { code, percent }) {
  await selectActivityFromModalByCodeOrFirst(page, code);
  await clickHourMarkerClosestToPercentMobile(page, percent);
}

async function goToSecondaryTimeline(page) {
  const nextBtn = page.locator('#nextBtn');
  await expect(nextBtn).toBeVisible();
  await expect(nextBtn).toBeEnabled();
  await nextBtn.click();

  await expect
    .poll(
      async () =>
        page.evaluate(
          () => window.timelineManager.keys[window.timelineManager.currentIndex]
        ),
      {
        timeout: 10000,
        message: 'Waiting to switch to secondary timeline',
      }
    )
    .toBe('secondary');
}

async function openSubmitConfirmation(page) {
  const nextBtn = page.locator('#nextBtn');
  const confirmationModal = page.locator('#confirmationModal');

  await expect(nextBtn).toBeVisible();
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

test('mobile: failed submit auto-retries and proceeds without manual retry', async ({
  page,
}) => {
  let submitAttempts = 0;

  await page.route(
    '**/studies/**/participants/**/day_labels/**/activities',
    async (route) => {
      submitAttempts += 1;

      if (submitAttempts === 1) {
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
    }
  );

  await page.goto('index.html?study_name=default&lang=en', {
    waitUntil: 'domcontentloaded',
  });

  await enterStudyIfNeeded(page);

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

  await addActivityAtPercentMobile(page, { code: 1101, percent: 70 });
  await goToSecondaryTimeline(page);
  await addActivityAtPercentMobile(page, { code: null, percent: 10 });

  const nextBtn = page.locator('#nextBtn');
  const navSubmitBtn = page.locator('#navSubmitBtn');
  const confirmationModal = page.locator('#confirmationModal');
  const loadingModal = page.locator('#loadingModal');
  const currentDayDisplay = page.locator('#currentDayDisplay');

  await expect(nextBtn).toBeEnabled();
  await expect(navSubmitBtn).toBeEnabled();

  await openSubmitConfirmation(page);
  await page.locator('#confirmOk').click();

  await expect
    .poll(async () => submitAttempts, {
      timeout: 10000,
      message: 'Waiting for auto-retry submit attempts',
    })
    .toBe(2);

  await expect(loadingModal).toBeHidden({ timeout: 10000 });

  // Auto-retry succeeds on the second attempt, so we should advance to the next day
  await expect(currentDayDisplay).toHaveAttribute('title', /Tuesday/, {
    timeout: 30000,
  });

  await expect(confirmationModal).toBeHidden();
});
