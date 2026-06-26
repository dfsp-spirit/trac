const { test, expect } = require('@playwright/test');

test.use({ viewport: { width: 1600, height: 900 } });

async function waitForActivitiesLoaded(page) {
  await expect
    .poll(
      async () => page.locator('#activitiesContainer .activity-button').count(),
      {
        timeout: 30000,
        message: 'Waiting for activities to load',
      }
    )
    .toBeGreaterThan(0);
}

async function enterDiaryIfNeeded(page) {
  const continueBtn = page.locator('#continueBtn');
  const hasInstructionsStart = await continueBtn
    .waitFor({ state: 'visible', timeout: 3000 })
    .then(() => true)
    .catch(() => false);

  if (hasInstructionsStart) {
    await continueBtn.click();
    await page.waitForLoadState('domcontentloaded');
  }
}

async function selectFirstVisibleActivity(page) {
  await waitForActivitiesLoaded(page);

  const placeable = page.locator(
    '#activitiesContainer .activity-button:visible:not(.has-child-items):not(.custom-input)'
  );

  if (await placeable.count()) {
    await placeable.first().click();
  } else {
    await page
      .locator('#activitiesContainer .activity-button:visible')
      .first()
      .click();
  }

  await expect
    .poll(async () => page.evaluate(() => !!window.selectedActivity), {
      timeout: 3000,
      message: 'Waiting for selected activity state after button click',
    })
    .toBeTruthy();
}

async function clickActiveTimelineAtPercent(page, targetPercent) {
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

async function addActivityAtPercentAndGetId(page, percent) {
  const before = await page.evaluate(() => {
    const key =
      window.timelineManager.keys[window.timelineManager.currentIndex];
    const ids = (window.timelineManager.activities[key] || []).map((a) =>
      String(a.id)
    );
    return { key, ids };
  });

  await selectFirstVisibleActivity(page);
  await clickActiveTimelineAtPercent(page, percent);

  await expect
    .poll(
      async () => {
        return page.evaluate((beforeIds) => {
          const key =
            window.timelineManager.keys[window.timelineManager.currentIndex];
          const ids = (window.timelineManager.activities[key] || []).map((a) =>
            String(a.id)
          );
          return ids.find((id) => !beforeIds.includes(id)) || null;
        }, before.ids);
      },
      {
        timeout: 5000,
        message:
          'Waiting for newly placed activity to appear in timeline state',
      }
    )
    .not.toBeNull();

  return page.evaluate((beforeIds) => {
    const key =
      window.timelineManager.keys[window.timelineManager.currentIndex];
    const ids = (window.timelineManager.activities[key] || []).map((a) =>
      String(a.id)
    );
    return ids.find((id) => !beforeIds.includes(id)) || null;
  }, before.ids);
}

test('reload preserves unsaved timeline activities from local draft state', async ({
  page,
}) => {
  const pid = `reload_draft_${Date.now()}`;
  const url = `index.html?study_name=default&lang=en&day_label_index=0&pid=${pid}`;

  await page.goto(url, { waitUntil: 'domcontentloaded' });
  await enterDiaryIfNeeded(page);

  const timeline = page
    .locator('.timeline-container[data-active="true"] .timeline')
    .first();
  await expect(timeline).toBeVisible();
  await waitForActivitiesLoaded(page);

  const activityId = await addActivityAtPercentAndGetId(page, 30);
  expect(activityId).toBeTruthy();

  const block = page
    .locator(
      `.timeline-container[data-active="true"] .activity-block[data-id="${activityId}"]`
    )
    .first();
  await expect(block).toBeVisible();

  // Wait for draft to be persisted to localStorage (debounce is 100ms in persistPendingTimelineStateSoon)
  await expect
    .poll(
      () => page.evaluate(() => localStorage.getItem('trac.timelineDraftState.v1')),
      { timeout: 5000, message: 'Waiting for draft to be persisted to localStorage before reload' }
    )
    .toBeTruthy();

  await page.reload({ waitUntil: 'domcontentloaded' });
  await enterDiaryIfNeeded(page);
  await expect(timeline).toBeVisible();

  const restoredBlock = page
    .locator(
      `.timeline-container[data-active="true"] .activity-block[data-id="${activityId}"]`
    )
    .first();
  await expect(restoredBlock).toBeVisible();

  await expect
    .poll(
      async () => {
        return page.evaluate((id) => {
          const key =
            window.timelineManager.keys[window.timelineManager.currentIndex];
          const activities = window.timelineManager.activities[key] || [];
          return activities.some((a) => String(a.id) === String(id));
        }, activityId);
      },
      {
        timeout: 5000,
        message:
          'Waiting for restored activity to appear in timeline state after reload',
      }
    )
    .toBeTruthy();
});
