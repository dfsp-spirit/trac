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

  const after = await page.evaluate((beforeIds) => {
    const key =
      window.timelineManager.keys[window.timelineManager.currentIndex];
    const ids = (window.timelineManager.activities[key] || []).map((a) =>
      String(a.id)
    );
    return ids.find((id) => !beforeIds.includes(id)) || null;
  }, before.ids);

  return after;
}

async function resizeRightEdge(page, blockId, dragPx) {
  const block = page
    .locator(
      '.timeline-container[data-active="true"] .activity-block[data-id="' +
        blockId +
        '"]'
    )
    .first();
  await expect(block).toBeVisible();
  const box = await block.boundingBox();
  expect(box).not.toBeNull();
  const x = box.x + box.width - 1;
  const y = box.y + box.height / 2;
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x + dragPx, y, { steps: 8 });
  await page.mouse.up();
  await page.waitForTimeout(400);
}

async function getActivityState(page, timelineKey, activityId) {
  return page.evaluate(
    ({ key, id }) => {
      const activity = (window.timelineManager.activities[key] || []).find(
        (a) => String(a.id) === String(id)
      );
      if (!activity) return null;
      return {
        startTime: activity.startTime,
        endTime: activity.endTime,
        startMinutes: activity.startMinutes,
        endMinutes: activity.endMinutes,
        blockLength: activity.blockLength,
        activity: activity.activity,
        category: activity.category,
        color: activity.color,
      };
    },
    { key: timelineKey, id: String(activityId) }
  );
}

test('desktop context menu copy places activity with same duration at clicked position', async ({
  page,
}) => {
  const pid = `copy_ctxmenu_e2e_${Date.now()}`;

  await page.goto(
    `index.html?study_name=default&lang=en&day_label_index=0&pid=${pid}`,
    {
      waitUntil: 'domcontentloaded',
    }
  );

  const continueBtn = page.locator('#continueBtn');
  const hasInstructionsStart = await continueBtn
    .waitFor({ state: 'visible', timeout: 3000 })
    .then(() => true)
    .catch(() => false);

  if (hasInstructionsStart) {
    await continueBtn.click();
    await page.waitForLoadState('domcontentloaded');
  }

  await expect(
    page.locator('.timeline-container[data-active="true"] .timeline').first()
  ).toBeVisible();
  await waitForActivitiesLoaded(page);

  const firstActivityId = await addActivityAtPercentAndGetId(page, 20);
  expect(firstActivityId).toBeTruthy();

  const firstBlock = page
    .locator(
      `.timeline-container[data-active="true"] .activity-block[data-id="${firstActivityId}"]`
    )
    .first();
  await expect(firstBlock).toBeVisible();

  const timelineKey = await page.evaluate(
    () => window.timelineManager.keys[window.timelineManager.currentIndex]
  );

  const timelineBox = await page
    .locator('.timeline-container[data-active="true"] .timeline')
    .first()
    .boundingBox();
  expect(timelineBox).not.toBeNull();

  const widenPx = (50 / 1440) * timelineBox.width;
  await resizeRightEdge(page, firstActivityId, widenPx);

  const originalState = await getActivityState(page, timelineKey, firstActivityId);
  expect(originalState).not.toBeNull();
  expect(originalState.blockLength).toBeGreaterThanOrEqual(40);

  await firstBlock.click({ button: 'right' });

  const menu = page.locator('#activityContextMenu');
  await expect(menu).toBeVisible();
  await expect(menu.locator('[data-action="copy"]')).toHaveText('Copy');
  await expect(menu.locator('[data-action="show-info"]')).toHaveText(
    'Show info'
  );
  await expect(menu.locator('[data-action="delete"]')).toHaveText('Delete');

  await menu.locator('[data-action="copy"]').click();

  await expect(menu).not.toBeVisible();

  await expect
    .poll(
      async () => page.evaluate(() => document.body.classList.contains('carrying-activity')),
      {
        timeout: 3000,
        message: 'Waiting for carrying-activity class after copy',
      }
    )
    .toBeTruthy();

  await expect
    .poll(async () => page.evaluate(() => !!window.selectedActivity), {
      timeout: 3000,
      message: 'Waiting for selectedActivity to be set after copy',
    })
    .toBeTruthy();

  const copiedBlockLength = await page.evaluate(
    () => window.selectedActivity.blockLength
  );
  expect(copiedBlockLength).toBe(originalState.blockLength);

  await page.waitForTimeout(350);
  await clickActiveTimelineAtPercent(page, 60);

  await expect
    .poll(async () => page.evaluate(() => !window.selectedActivity), {
      timeout: 5000,
      message: 'Waiting for selectedActivity to be cleared after paste',
    })
    .toBeTruthy();

  await expect
    .poll(
      async () =>
        page.evaluate(() => document.body.classList.contains('carrying-activity')),
      {
        timeout: 3000,
        message: 'Waiting for carrying-activity class to be removed after paste',
      }
    )
    .toBeFalsy();

  const allActivities = await page.evaluate((key) => {
    return (window.timelineManager.activities[key] || []).map((a) => ({
      id: String(a.id),
      startMinutes: a.startMinutes,
      endMinutes: a.endMinutes,
      blockLength: a.blockLength,
      activity: a.activity,
      category: a.category,
    }));
  }, timelineKey);

  expect(allActivities.length).toBe(2);

  const original = allActivities.find(
    (a) => a.id === String(firstActivityId)
  );
  const copy = allActivities.find(
    (a) => a.id !== String(firstActivityId)
  );

  expect(original).toBeTruthy();
  expect(copy).toBeTruthy();

  expect(copy.blockLength).toBe(original.blockLength);
  expect(copy.activity).toBe(original.activity);
  expect(copy.category).toBe(original.category);

  expect(copy.startMinutes).not.toBe(original.startMinutes);
  expect(copy.startMinutes).toBeGreaterThan(original.startMinutes);

  const originalStillExists = await firstBlock.isVisible();
  expect(originalStillExists).toBeTruthy();
});
