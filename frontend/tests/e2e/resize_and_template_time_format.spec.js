const { test, expect } = require('@playwright/test');

test.use({ viewport: { width: 1600, height: 900 } });

async function waitForActivitiesLoaded(page) {
  await expect
    .poll(async () => page.locator('#activitiesContainer .activity-button').count(), {
      timeout: 30000,
      message: 'Waiting for activities to load',
    })
    .toBeGreaterThan(0);
}

async function getCurrentTimelineKey(page) {
  return page.evaluate(() => window.timelineManager.keys[window.timelineManager.currentIndex]);
}

async function switchToTimelineKey(page, timelineKey) {
  const current = await getCurrentTimelineKey(page);
  if (current === timelineKey) return;

  const timelineContainer = page.locator(`.timeline-container:has(#${timelineKey})`).first();
  await expect(timelineContainer).toBeVisible({ timeout: 10000 });
  await timelineContainer.click();

  await expect
    .poll(async () => getCurrentTimelineKey(page), {
      timeout: 10000,
      message: `Waiting to switch to timeline '${timelineKey}'`,
    })
    .toBe(timelineKey);
}

async function goToSecondaryTimeline(page) {
  const nextBtn = page.locator('#nextBtn');
  await expect(nextBtn).toBeVisible();
  await expect(nextBtn).toBeEnabled();
  await nextBtn.click();

  await expect
    .poll(async () => getCurrentTimelineKey(page), {
      timeout: 10000,
      message: 'Waiting to switch to secondary timeline',
    })
    .toBe('secondary');
}

async function clickTimelineAtPercent(page, targetPercent) {
  await page.waitForTimeout(350);

  const timeline = page.locator('.timeline-container[data-active="true"] .timeline').first();
  await expect(timeline).toBeVisible();

  const box = await timeline.boundingBox();
  expect(box).not.toBeNull();

  const x = box.x + (box.width * targetPercent) / 100;
  const y = box.y + box.height / 2;

  await page.mouse.click(x, y);
}

async function selectFirstVisibleActivity(page) {
  await waitForActivitiesLoaded(page);

  const placeable = page.locator(
    '#activitiesContainer .activity-button:visible:not(.has-child-items):not(.custom-input)'
  );

  if (await placeable.count()) {
    await placeable.first().click();
    await expect
      .poll(async () => page.evaluate(() => !!window.selectedActivity), {
        timeout: 3000,
        message: 'Waiting for selected activity state after button click',
      })
      .toBeTruthy();
    return;
  }

  await page.locator('#activitiesContainer .activity-button:visible').first().click();
  await expect
    .poll(async () => page.evaluate(() => !!window.selectedActivity), {
      timeout: 3000,
      message: 'Waiting for selected activity state after fallback button click',
    })
    .toBeTruthy();
}

async function addActivityAtPercentAndGetId(page, percent) {
  const before = await page.evaluate(() => {
    const key = window.timelineManager.keys[window.timelineManager.currentIndex];
    const ids = (window.timelineManager.activities[key] || []).map((a) => String(a.id));
    return { key, ids };
  });

  await selectFirstVisibleActivity(page);
  await clickTimelineAtPercent(page, percent);

  await expect
    .poll(async () => {
      return page.evaluate((beforeIds) => {
        const key = window.timelineManager.keys[window.timelineManager.currentIndex];
        const ids = (window.timelineManager.activities[key] || []).map((a) => String(a.id));
        return ids.find((id) => !beforeIds.includes(id)) || null;
      }, before.ids);
    }, {
      timeout: 5000,
      message: 'Waiting for newly placed activity to appear in timeline state',
    })
    .not.toBeNull();

  const after = await page.evaluate((beforeIds) => {
    const key = window.timelineManager.keys[window.timelineManager.currentIndex];
    const ids = (window.timelineManager.activities[key] || []).map((a) => String(a.id));
    const newId = ids.find((id) => !beforeIds.includes(id));
    return { key, ids, newId };
  }, before.ids);

  expect(after.newId).toBeTruthy();
  return after.newId;
}

async function resizeBlockLeftThenRight(page, blockId, leftDragPx = -25, rightDragPx = 25) {
  const block = page.locator(`.timeline-container[data-active="true"] .activity-block[data-id="${blockId}"]`).first();
  await expect(block).toBeVisible();

  const box = await block.boundingBox();
  expect(box).not.toBeNull();

  const y = box.y + box.height / 2;

  await page.mouse.move(box.x + 1, y);
  await page.mouse.down();
  await page.mouse.move(box.x + 1 + leftDragPx, y, { steps: 8 });
  await page.mouse.up();

  const box2 = await block.boundingBox();
  expect(box2).not.toBeNull();

  const y2 = box2.y + box2.height / 2;
  await page.mouse.move(box2.x + box2.width - 1, y2);
  await page.mouse.down();
  await page.mouse.move(box2.x + box2.width - 1 + rightDragPx, y2, { steps: 8 });
  await page.mouse.up();
}

async function getActivityStateById(page, timelineKey, activityId) {
  return page.evaluate(({ key, id }) => {
    const activity = (window.timelineManager.activities[key] || []).find((a) => String(a.id) === String(id));
    return activity || null;
  }, { key: timelineKey, id: activityId });
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

test('resize activities across timelines keeps minute/time-format integrity and Tuesday templates', async ({ page }) => {
  await page.goto('index.html?study_name=default&lang=en', { waitUntil: 'domcontentloaded' });

  await expect(page).toHaveURL(/pages\/instructions\.html/);
  await page.locator('#continueBtn').click();
  await expect(page).toHaveURL(/index\.html/);
  await expect(page.locator('#currentDayDisplay')).toHaveAttribute('title', /Monday/);

  const p1 = await addActivityAtPercentAndGetId(page, 25);
  await resizeBlockLeftThenRight(page, p1, -25, 25);

  const p2 = await addActivityAtPercentAndGetId(page, 70);
  await resizeBlockLeftThenRight(page, p2, -20, 20);

  await goToSecondaryTimeline(page);

  const s1 = await addActivityAtPercentAndGetId(page, 25);
  await resizeBlockLeftThenRight(page, s1, -25, 25);

  const s2 = await addActivityAtPercentAndGetId(page, 70);
  await resizeBlockLeftThenRight(page, s2, -20, 20);

  const p1State = await getActivityStateById(page, 'primary', p1);
  const p2State = await getActivityStateById(page, 'primary', p2);
  const s1State = await getActivityStateById(page, 'secondary', s1);
  const s2State = await getActivityStateById(page, 'secondary', s2);

  for (const state of [p1State, p2State, s1State, s2State]) {
    expect(state).toBeTruthy();
    expect(state.blockLength).toBeGreaterThanOrEqual(30);
    expect(state.startTime).toMatch(/^\d{2}:\d{2}(\(\+1\))?$/);
    expect(state.endTime).toMatch(/^\d{2}:\d{2}(\(\+1\))?$/);
    expect(state.startTime.includes(' ')).toBeFalsy();
    expect(state.endTime.includes(' ')).toBeFalsy();
  }

  await switchToTimelineKey(page, 'primary');
  await switchToTimelineKey(page, 'secondary');
  await switchToTimelineKey(page, 'primary');
  await switchToTimelineKey(page, 'secondary');

  await submitCurrentDay(page, 'Tuesday');

  const tuesdayState = await page.evaluate(() => {
    const data = window.timelineManager.activities;
    const primary = data.primary || [];
    const secondary = data.secondary || [];

    const all = [...primary, ...secondary];

    return {
      primaryCount: primary.length,
      secondaryCount: secondary.length,
      total: all.length,
      primaryIntegrity: primary.every((a) => a.timelineKey === 'primary'),
      secondaryIntegrity: secondary.every((a) => a.timelineKey === 'secondary'),
      cleanFormat: all.every(
        (a) =>
          /^\d{2}:\d{2}(\(\+1\))?$/.test(a.startTime) &&
          /^\d{2}:\d{2}(\(\+1\))?$/.test(a.endTime) &&
          !a.startTime.includes(' ') &&
          !a.endTime.includes(' ')
      ),
    };
  });

  expect(tuesdayState.primaryCount).toBe(2);
  expect(tuesdayState.secondaryCount).toBe(2);
  expect(tuesdayState.total).toBe(4);
  expect(tuesdayState.primaryIntegrity).toBeTruthy();
  expect(tuesdayState.secondaryIntegrity).toBeTruthy();
  expect(tuesdayState.cleanFormat).toBeTruthy();

  await switchToTimelineKey(page, 'primary');

  const primaryFirstTemplateId = await page.evaluate(() => {
    const primary = window.timelineManager.activities.primary || [];
    return primary.length ? String(primary[0].id) : null;
  });
  expect(primaryFirstTemplateId).toBeTruthy();

  await resizeBlockLeftThenRight(page, primaryFirstTemplateId, -15, 20);

  const resizedTemplate = await getActivityStateById(page, 'primary', primaryFirstTemplateId);
  expect(resizedTemplate).toBeTruthy();
  expect(resizedTemplate.blockLength).toBeGreaterThanOrEqual(30);
  expect(resizedTemplate.startTime).toMatch(/^\d{2}:\d{2}(\(\+1\))?$/);
  expect(resizedTemplate.endTime).toMatch(/^\d{2}:\d{2}(\(\+1\))?$/);
  expect(resizedTemplate.startTime.includes(' ')).toBeFalsy();
  expect(resizedTemplate.endTime.includes(' ')).toBeFalsy();
});
