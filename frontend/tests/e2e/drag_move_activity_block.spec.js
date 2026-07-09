const { test, expect } = require('@playwright/test');
const { enterStudyIfNeeded } = require('./e2e_helpers.js');

test.use({ viewport: { width: 1600, height: 900 } });

async function waitForActivitiesLoaded(page) {
  await expect
    .poll(
      async () => page.locator('#activitiesContainer .activity-button').count(),
      { timeout: 30000, message: 'Waiting for activities to load' }
    )
    .toBeGreaterThan(0);
}

async function getCurrentTimelineKey(page) {
  return page.evaluate(
    () => window.timelineManager.keys[window.timelineManager.currentIndex]
  );
}

async function selectFirstPlaceableActivity(page) {
  await waitForActivitiesLoaded(page);
  const placeable = page.locator(
    '#activitiesContainer .activity-button:visible:not(.has-child-items):not(.custom-input)'
  );
  await expect(placeable.first()).toBeVisible({ timeout: 5000 });
  await placeable.first().click();
  await expect
    .poll(async () => page.evaluate(() => !!window.selectedActivity), {
      timeout: 3000,
      message: 'Waiting for selectedActivity',
    })
    .toBeTruthy();
}

async function clickTimelineAtPercent(page, targetPercent) {
  await page.waitForTimeout(350);
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
  const beforeIds = await page.evaluate(() => {
    const key = window.timelineManager.keys[window.timelineManager.currentIndex];
    return (window.timelineManager.activities[key] || []).map((a) => String(a.id));
  });
  const timelineKey = await getCurrentTimelineKey(page);
  await selectFirstPlaceableActivity(page);
  await clickTimelineAtPercent(page, percent);
  await expect
    .poll(
      async () =>
        page.evaluate((ids) => {
          const key = window.timelineManager.keys[window.timelineManager.currentIndex];
          const current = (window.timelineManager.activities[key] || []).map((a) => String(a.id));
          return current.find((id) => !ids.includes(id)) || null;
        }, beforeIds),
      { timeout: 5000, message: 'Waiting for new activity' }
    )
    .not.toBeNull();
  const after = await page.evaluate(
    (ids) => {
      const key = window.timelineManager.keys[window.timelineManager.currentIndex];
      const current = (window.timelineManager.activities[key] || []).map((a) => String(a.id));
      return { key, newId: current.find((id) => !ids.includes(id)) };
    },
    beforeIds
  );
  expect(after.newId).toBeTruthy();
  return { id: String(after.newId), timelineKey: after.key };
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
      };
    },
    { key: timelineKey, id: String(activityId) }
  );
}

async function resizeRightEdge(page, blockId, dragPx) {
  const block = page
    .locator('.timeline-container[data-active="true"] .activity-block[data-id="' + blockId + '"]')
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

async function dragBlockBodyRight(page, blockId, dragPx) {
  const block = page
    .locator('.timeline-container[data-active="true"] .activity-block[data-id="' + blockId + '"]')
    .first();
  await expect(block).toBeVisible();
  const box = await block.boundingBox();
  expect(box).not.toBeNull();
  const cx = box.x + box.width / 2;
  const cy = box.y + box.height / 2;
  await page.mouse.move(cx, cy);
  await page.mouse.down();
  await page.mouse.move(cx + dragPx, cy, { steps: 10 });
  await page.mouse.up();
  await page.waitForTimeout(600);
}

test('drag-to-move shifts both start and end times, preserves duration', async ({ page }) => {
  await page.goto('index.html?study_name=15yearolds&lang=en', { waitUntil: 'domcontentloaded' });
  await enterStudyIfNeeded(page);
  await expect(page).toHaveURL(/index\.html/);
  await expect(page.locator('#currentDayDisplay')).toBeVisible();

  const { id: activityId, timelineKey } = await addActivityAtPercentAndGetId(page, 25);

  const initial = await getActivityState(page, timelineKey, activityId);
  expect(initial).not.toBeNull();
  expect(initial.blockLength).toBe(10);

  const timelineBox = await page
    .locator('.timeline-container[data-active="true"] .timeline')
    .first()
    .boundingBox();
  expect(timelineBox).not.toBeNull();

  // Widen block to ~60 min so it is wide enough for body-drag vs edge-resize
  const widenPx = (60 / 1440) * timelineBox.width;
  await resizeRightEdge(page, activityId, widenPx);

  const beforeDrag = await getActivityState(page, timelineKey, activityId);
  expect(beforeDrag).not.toBeNull();
  expect(beforeDrag.blockLength).toBeGreaterThanOrEqual(50);

  // Drag body right ~2 hours.
  // Temporarily disable resizable on this block so interact.js prioritizes drag.
  await page.evaluate((id) => {
    const el = document.querySelector('.activity-block[data-id="' + id + '"]');
    if (el && window.interact) {
      window.interact(el).resizable(false);
    }
  }, activityId);

  const dragPx = (120 / 1440) * timelineBox.width;
  await dragBlockBodyRight(page, activityId, dragPx);

  // Re-enable resizable
  await page.evaluate((id) => {
    const el = document.querySelector('.activity-block[data-id="' + id + '"]');
    if (el && window.interact) {
      window.interact(el).resizable({
        edges: { right: true, left: true, bottom: false, top: false },
      });
    }
  }, activityId);

  const afterDrag = await getActivityState(page, timelineKey, activityId);
  expect(afterDrag).not.toBeNull();

  expect(afterDrag.blockLength).toBe(beforeDrag.blockLength);
  expect(afterDrag.startMinutes).toBeGreaterThan(beforeDrag.startMinutes);
  expect(afterDrag.endMinutes).toBeGreaterThan(beforeDrag.endMinutes);

  const startDelta = afterDrag.startMinutes - beforeDrag.startMinutes;
  const endDelta = afterDrag.endMinutes - beforeDrag.endMinutes;
  expect(startDelta).toBe(endDelta);
  expect(startDelta % 10).toBe(0);
  expect(startDelta).toBeGreaterThan(0);
});
