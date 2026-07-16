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

test('copy day target picker excludes current day', async ({ page }) => {
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

  // Now Tuesday should offer switch buttons for already-saved days (Monday).
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

  const switchRow = page.locator('#previousDaysSwitchRow');
  await expect(switchRow).toBeVisible({ timeout: 30000 });

  // Verify getEmptyTargetDayIndices excludes current day (Tuesday = index 1)
  const emptyTargets = await page.evaluate(() => {
    return typeof window.getEmptyTargetDayIndices === 'function'
      ? window.getEmptyTargetDayIndices()
      : null;
  });
  expect(emptyTargets).not.toBeNull();
  expect(Array.isArray(emptyTargets)).toBe(true);
  expect(emptyTargets).not.toContain(1);

  // Place an activity on Tuesday to meet min coverage and enable the Monday button
  const mondayButton = switchRow.locator('button:has-text("Monday")');
  await expect(mondayButton).toBeVisible();

  // Place an activity on Tuesday to meet min coverage and enable the Monday button
  await placeSingleActivity(page);

  // Trigger re-render of the switch row to update button states
  await page.evaluate(() => {
    if (typeof window.renderPreviousDaysSwitchRow === 'function') {
      window.renderPreviousDaysSwitchRow();
    }
  });

  // Now the Monday button should be enabled
  await expect(mondayButton).toBeEnabled();

  // Right-click on Monday button to open copy target picker
  await mondayButton.click({ button: 'right' });

  // Wait for context menu to appear
  const contextMenu = page.locator('.copy-day-context-menu');
  await expect(contextMenu).toBeVisible({ timeout: 5000 });

  // Get all menu items
  const menuItems = contextMenu.locator('.copy-day-context-menu-item');
  const itemCount = await menuItems.count();

  // Verify none of the menu items contain "Tuesday" (current day)
  for (let i = 0; i < itemCount; i++) {
    const itemText = await menuItems.nth(i).textContent();
    expect(itemText).not.toContain('Tuesday');
  }

  // Verify the empty target indices from the page state don't include current day
  const currentDayIndex = await page.evaluate(() => {
    const urlParams = new URLSearchParams(window.location.search);
    return parseInt(urlParams.get('day_label_index')) || 0;
  });
  expect(currentDayIndex).toBe(1);

  // Verify getEmptyTargetDayCount excludes current day
  const emptyCount = await page.evaluate(() => {
    return typeof window.getEmptyTargetDayCount === 'function'
      ? window.getEmptyTargetDayCount()
      : null;
  });
  expect(emptyCount).not.toBeNull();

  // Count should equal the number of menu items
  expect(emptyCount).toBe(itemCount);
});
