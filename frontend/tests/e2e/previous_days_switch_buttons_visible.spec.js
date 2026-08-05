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

  await expect
    .poll(
      async () => {
        const currentUrl = page.url();
        return Number(
          new URL(currentUrl).searchParams.get('day_label_index') || 0
        );
      },
      {
        timeout: 30000,
        message: 'Waiting for day_label_index=1 after submission',
      }
    )
    .toBe(1);

  await expect(currentDayDisplay).toHaveAttribute(
    'title',
    new RegExp(expectedDayName),
    {
      timeout: 30000,
    }
  );
}

test('shows previous-day switch buttons when days with saved data exist', async ({
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

  // All study days (Monday..Sunday) are rendered now, not just days with data.
  const dayButtons = switchRow.locator('.previous-day-btn');
  await expect(dayButtons).toHaveCount(7);
  await expect(dayButtons.first()).toContainText('Monday');

  // Monday was saved and meets min_coverage, so it gets the green checkmark.
  const mondayButton = dayButtons.filter({ hasText: 'Monday' });
  await expect(mondayButton).toHaveClass(/day-complete/);
  await expect(
    mondayButton.locator('.day-complete-check')
  ).toContainText('✓');

  const currentDayButton = dayButtons.filter({ hasText: 'Tuesday' });
  await expect(currentDayButton).toBeDisabled();
});
