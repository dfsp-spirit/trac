const { test, expect } = require('@playwright/test');

const DESKTOP_VIEWPORT = { width: 1600, height: 900 };
const MOBILE_VIEWPORT = { width: 390, height: 844 };

test.use({ viewport: DESKTOP_VIEWPORT });

async function waitForActivitiesLoaded(page) {
  await expect
    .poll(async () => page.locator('#activitiesContainer .activity-button').count(), {
      timeout: 30000,
      message: 'Waiting for activities to load',
    })
    .toBeGreaterThan(0);
}

async function waitForActiveTimelineLayout(page, expectedLayout) {
  await expect
    .poll(
      async () => page.locator('.timeline-container[data-active="true"] .timeline').first().getAttribute('data-layout'),
      { timeout: 30000, message: `Waiting for active timeline layout=${expectedLayout}` }
    )
    .toBe(expectedLayout);
}

async function selectFirstPlaceableActivity(page) {
  await waitForActivitiesLoaded(page);

  const button = page
    .locator('#activitiesContainer .activity-button:visible:not(.has-child-items):not(.custom-input)')
    .first();

  await expect(button).toBeVisible({ timeout: 10000 });
  await button.click();

  await expect
    .poll(async () => page.evaluate(() => !!window.selectedActivity), {
      timeout: 5000,
      message: 'Waiting for selected activity state',
    })
    .toBeTruthy();
}

async function clickActiveTimelineAtPercent(page, percent) {
  const timeline = page.locator('.timeline-container[data-active="true"] .timeline').first();
  await expect(timeline).toBeVisible({ timeout: 10000 });

  const box = await timeline.boundingBox();
  expect(box).not.toBeNull();

  const x = box.x + (box.width * percent) / 100;
  const y = box.y + box.height / 2;
  await page.mouse.click(x, y);
}

test('delete in mobile persists after resizing to desktop without submit', async ({ page }) => {
  const pid = `e2e-delete-resize-${Date.now()}`;

  await page.goto(`index.html?study_name=default&lang=en&pid=${pid}`, { waitUntil: 'domcontentloaded' });

  await expect(page).toHaveURL(/pages\/instructions\.html/);
  await page.locator('#continueBtn').click();
  await expect(page).toHaveURL(/index\.html/);

  await selectFirstPlaceableActivity(page);
  await clickActiveTimelineAtPercent(page, 50);

  await expect
    .poll(async () => page.evaluate(() => {
      const key = window.timelineManager.keys[window.timelineManager.currentIndex];
      return (window.timelineManager.activities[key] || []).length;
    }), {
      timeout: 5000,
      message: 'Waiting for created activity in timeline state',
    })
    .toBe(1);

  await page.evaluate(() => {
    const key = window.timelineManager.keys[window.timelineManager.currentIndex];
    const timelineActivities = window.timelineManager.activities[key] || [];
    if (!timelineActivities.length) {
      throw new Error('No activity found to prepare numeric-id regression check');
    }
    timelineActivities[0].id = 424242;
  });

  await page.setViewportSize(MOBILE_VIEWPORT);
  await expect(page).toHaveURL(/index\.html/);
  await waitForActiveTimelineLayout(page, 'vertical');

  const mobileBlock = page.locator('.timeline-container[data-active="true"] .activity-block[data-id="424242"]').first();
  await expect(mobileBlock).toBeVisible({ timeout: 10000 });

  await mobileBlock.hover();
  await page.keyboard.press('Delete');

  await expect
    .poll(async () => page.evaluate(() => {
      const key = window.timelineManager.keys[window.timelineManager.currentIndex];
      return (window.timelineManager.activities[key] || []).length;
    }), {
      timeout: 5000,
      message: 'Waiting for deleted activity to be removed from timeline state',
    })
    .toBe(0);

  await expect(
    page.locator('.timeline-container[data-active="true"] .activity-block[data-id="424242"]')
  ).toHaveCount(0);

  await page.setViewportSize(DESKTOP_VIEWPORT);
  await expect(page).toHaveURL(/index\.html/);
  await waitForActiveTimelineLayout(page, 'horizontal');

  await expect
    .poll(async () => page.evaluate(() => {
      const key = window.timelineManager.keys[window.timelineManager.currentIndex];
      return (window.timelineManager.activities[key] || []).length;
    }), {
      timeout: 5000,
      message: 'Deleted activity must stay removed after mobile->desktop reload',
    })
    .toBe(0);

  await expect(
    page.locator('.timeline-container[data-active="true"] .activity-block[data-id="424242"]')
  ).toHaveCount(0);
});
