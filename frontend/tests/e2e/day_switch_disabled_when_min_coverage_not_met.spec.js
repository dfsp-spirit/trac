const { test, expect } = require('@playwright/test');
const { enterStudyIfNeeded } = require('./e2e_helpers.js');

test.use({ viewport: { width: 1600, height: 900 } });

async function waitForActivitiesLoaded(page) {
  await expect
    .poll(
      async () => page.locator('#activitiesContainer .activity-button').count(),
      {
        timeout: 30000,
        message: 'Waiting for activity buttons to load',
      }
    )
    .toBeGreaterThan(0);
}

async function clickTimelineAtPercent(page, targetPercent) {
  const timeline = page
    .locator('.timeline-container[data-active="true"] .timeline')
    .first();
  await expect(timeline).toBeVisible();

  const box = await timeline.boundingBox();
  expect(box).not.toBeNull();

  const x = box.x + (box.width * targetPercent) / 100;
  const y = box.y + box.height / 2;
  await page.mouse.click(x, y);
}

async function placeSingleActivity(page) {
  await waitForActivitiesLoaded(page);
  const firstActivity = page
    .locator(
      '#activitiesContainer .activity-button:visible:not(.has-child-items):not(.custom-input)'
    )
    .first();

  await firstActivity.click();
  await clickTimelineAtPercent(page, 25);

  await expect(
    page.locator('.timeline-container[data-active="true"] .activity-block')
  ).toHaveCount(1);
}

async function submitCurrentDayAndWaitFor(page, expectedDayName) {
  const submitBtn = page.locator('#navSubmitBtn');
  const confirmationModal = page.locator('#confirmationModal');
  const currentDayDisplay = page.locator('#currentDayDisplay');

  await expect(submitBtn).toBeVisible();
  await expect(submitBtn).toBeEnabled();

  for (let attempt = 0; attempt < 3; attempt += 1) {
    await submitBtn.click();

    if (await confirmationModal.isVisible()) {
      await page.locator('#confirmOk').click();
      break;
    }

    const maybeUpdatedTitle =
      (await currentDayDisplay.getAttribute('title')) || '';
    if (maybeUpdatedTitle.includes(expectedDayName)) {
      break;
    }

    await page.waitForTimeout(700);
  }

  await expect(currentDayDisplay).toHaveAttribute(
    'title',
    new RegExp(expectedDayName),
    {
      timeout: 30000,
    }
  );
}

test('day switch buttons disabled when min coverage not met, enabled when met', async ({
  page,
}) => {
  await page.goto('index.html?study_name=default&lang=en', {
    waitUntil: 'domcontentloaded',
  });

  await enterStudyIfNeeded(page);

  await expect(page.locator('#currentDayDisplay')).toHaveAttribute(
    'title',
    /Monday/
  );

  // Create data on Monday and submit to move to Tuesday.
  await placeSingleActivity(page);
  await submitCurrentDayAndWaitFor(page, 'Tuesday');

  // Wait for page to fully load after navigation
  await page.waitForLoadState('domcontentloaded');
  await page.waitForTimeout(1000);

  // Verify Monday data exists
  await expect
    .poll(
      async () => {
        return page.evaluate(
          () => window.timelineManager?.dayIndicesWithData || []
        );
      },
      {
        timeout: 30000,
        message: 'Waiting for backend-provided dayIndicesWithData',
      }
    )
    .toContain(0);

  // Switch row should be visible
  const switchRow = page.locator('#previousDaysSwitchRow');
  await expect(switchRow).toBeVisible({ timeout: 30000 });

  // Get the Monday button (the switch target)
  const mondayButton = switchRow.locator('button:has-text("Monday")');
  await expect(mondayButton).toBeVisible();

  // Day 1 (Tuesday) has no activities yet, so min coverage is NOT met.
  // The Monday button should be disabled with a tooltip.
  await expect(mondayButton).toBeDisabled();

  const titleBefore = await mondayButton.getAttribute('title');
  expect(titleBefore).toBeTruthy();
  expect(titleBefore).toContain('minimum');

  // Now place enough activities to meet min coverage (default is 10 minutes)
  await placeSingleActivity(page);

  // Trigger re-render of the switch row to update button states
  await page.evaluate(() => {
    if (typeof window.renderPreviousDaysSwitchRow === 'function') {
      window.renderPreviousDaysSwitchRow();
    }
  });

  // Verify coverage meets minimum
  const coverage = await page.evaluate(() => {
    return window.getTimelineCoverage ? window.getTimelineCoverage() : 0;
  });
  expect(coverage).toBeGreaterThanOrEqual(10);

  // The Monday button should now be enabled
  await expect(mondayButton).toBeEnabled();

  const titleAfter = await mondayButton.getAttribute('title');
  // Title should be cleared or no longer contain the warning message
  expect(titleAfter || '').not.toContain('minimum');
});
