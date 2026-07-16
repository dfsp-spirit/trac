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
        message: 'Waiting for day_label_index to advance after submission',
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

test('day switch buttons enabled on a day pre-filled with template activities', async ({
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

  // Fill out Monday enough to satisfy min_coverage (default primary = 10 min).
  await placeSingleActivity(page);
  await submitCurrentDayAndWaitFor(page, 'Tuesday');

  // Wait for the app to fully (re)load Tuesday, including any backend fetch of
  // template activities copied over from Monday.
  await page.waitForLoadState('domcontentloaded');

  // Monday must now be reported by the backend as a day with saved data.
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

  // Template activities copied from Monday should now be present on Tuesday.
  // They are guaranteed to satisfy min_coverage (the source day was saved and
  // therefore met coverage), so the day-switch buttons must be enabled.
  await expect
    .poll(
      async () =>
        page.locator(
          '.timeline-container[data-active="true"] .activity-block'
        ).count(),
      {
        timeout: 30000,
        message: 'Waiting for template activities to render on Tuesday',
      }
    )
    .toBeGreaterThan(0);

  // The template banner should be visible, confirming the activities came from
  // the previous day's template rather than from saved Tuesday data.
  await expect(page.locator('#templateBanner')).toBeVisible({
    timeout: 10000,
  });

  // Coverage on the current (Tuesday) day must meet the minimum, driven purely
  // by the unsaved templated activities.
  const coverage = await page.evaluate(() => {
    return typeof window.getTimelineCoverage === 'function'
      ? window.getTimelineCoverage()
      : 0;
  });
  expect(coverage).toBeGreaterThanOrEqual(10);

  const switchRow = page.locator('#previousDaysSwitchRow');
  await expect(switchRow).toBeVisible({ timeout: 30000 });

  const mondayButton = switchRow.locator('button:has-text("Monday")');
  await expect(mondayButton).toBeVisible();

  // The Monday button must be enabled: the template activities satisfy the
  // day's min_coverage, so saving Tuesday and switching back to Monday should
  // be allowed without error.
  await expect(mondayButton).toBeEnabled();

  // The enabling tooltip (minimum-activities warning) should be cleared.
  const titleAfter = (await mondayButton.getAttribute('title')) || '';
  expect(titleAfter).not.toContain('minimum');

  // ── Deleting the only template activity must re-disable the switch buttons ──
  // Without the renderPreviousDaysSwitchRow() call in deleteActivityBlock the
  // buttons would stay enabled and the next click would 400 with
  // "submitted activities do not meet timeline minimum".
  const templateBlock = page
    .locator('.timeline-container[data-active="true"] .activity-block')
    .first();
  await expect(templateBlock).toBeVisible();

  // Open the desktop right-click context menu on the activity block.
  await templateBlock.click({ button: 'right' });
  const contextMenu = page.locator('#activityContextMenu');
  await expect(contextMenu).toBeVisible();
  await expect(
    contextMenu.locator('.activity-context-menu-item[data-action="delete"]')
  ).toHaveText('Delete');

  // Delete the template activity.
  await contextMenu.locator('.activity-context-menu-item[data-action="delete"]').click();

  // The block must be gone from the DOM and from the timeline manager state.
  await expect(
    page.locator('.timeline-container[data-active="true"] .activity-block')
  ).toHaveCount(0);

  await expect
    .poll(
      async () => {
        return page.evaluate(() => {
          const key =
            window.timelineManager.keys[window.timelineManager.currentIndex];
          return (window.timelineManager.activities[key] || []).length;
        });
      },
      { timeout: 5000, message: 'Waiting for activity to be removed from manager' }
    )
    .toBe(0);

  // Coverage on the active timeline must now be below the minimum.
  const coverageAfterDelete = await page.evaluate(() => {
    return typeof window.getTimelineCoverage === 'function'
      ? window.getTimelineCoverage()
      : 0;
  });
  expect(coverageAfterDelete).toBeLessThan(10);

  // The Monday switch button must now be disabled with the "minimum" tooltip,
  // WITHOUT any manual re-render call — deleting an activity must itself refresh
  // the switch row so users cannot attempt a save that the backend would 400.
  await expect(mondayButton).toBeDisabled();

  const titleAfterDelete = (await mondayButton.getAttribute('title')) || '';
  expect(titleAfterDelete).toContain('minimum');

  // ── Re-adding an activity so coverage is met again must re-enable the buttons ──
  // This guards the create-activity path: placing a new block calls
  // updateButtonStates(), which now also re-renders the switch row.
  await placeSingleActivity(page);

  // Coverage must be back at or above the minimum.
  const coverageAfterReadd = await page.evaluate(() => {
    return typeof window.getTimelineCoverage === 'function'
      ? window.getTimelineCoverage()
      : 0;
  });
  expect(coverageAfterReadd).toBeGreaterThanOrEqual(10);

  // The Monday button must be enabled again, with no "minimum" tooltip.
  await expect(mondayButton).toBeEnabled();

  const titleAfterReadd = (await mondayButton.getAttribute('title')) || '';
  expect(titleAfterReadd).not.toContain('minimum');
});