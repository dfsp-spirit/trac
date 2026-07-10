const { test, expect } = require('@playwright/test');

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

test('deleting activity on inactive timeline is ignored - block survives and submit stays enabled', async ({
  page,
}) => {
  await page.goto('index.html?study_name=default&lang=en', {
    waitUntil: 'domcontentloaded',
  });

  await expect(page).toHaveURL(/pages\/instructions\.html/);
  await page.locator('#continueBtn').click();
  await page.waitForURL(/index\.html/, { timeout: 15000 });

  const nextBtn = page.locator('#nextBtn');
  const navSubmitBtn = page.locator('#navSubmitBtn');

  await expect(nextBtn).toBeDisabled();
  await expect(navSubmitBtn).toBeDisabled();

  // Place an activity on the primary (first) timeline
  await placeSingleActivity(page);

  await expect(nextBtn).toBeEnabled();
  await expect(navSubmitBtn).toBeEnabled();

  // Navigate to the secondary timeline
  for (let attempt = 0; attempt < 4; attempt += 1) {
    await nextBtn.click();
    await page.waitForTimeout(700);

    const currentKey = await page.evaluate(
      () => window.timelineManager.keys[window.timelineManager.currentIndex]
    );
    if (currentKey === 'secondary') {
      break;
    }
  }

  await expect
    .poll(async () =>
      page.evaluate(
        () => window.timelineManager.keys[window.timelineManager.currentIndex]
      )
    )
    .toBe('secondary');

  // Submit should still be enabled (primary has sufficient coverage)
  await expect(nextBtn).toBeEnabled();
  await expect(navSubmitBtn).toBeEnabled();

  // Hover over the primary activity block (now on an inactive timeline) and press Delete
  const primaryBlockWhileSecondaryActive = page
    .locator('.timeline-container:has(#primary) .activity-block')
    .first();
  await expect(primaryBlockWhileSecondaryActive).toBeVisible();

  await primaryBlockWhileSecondaryActive.hover();
  await page.keyboard.press('Delete');

  // Block must still be present — deletion on inactive timelines is not allowed
  await expect(
    page.locator('.timeline-container:has(#primary) .activity-block')
  ).toHaveCount(1);

  // Submit buttons must remain enabled — primary coverage is unchanged
  await expect(nextBtn).toBeEnabled();
  await expect(navSubmitBtn).toBeEnabled();
});

test('deleting activity on active timeline removes it and can disable submit', async ({
  page,
}) => {
  await page.goto('index.html?study_name=default&lang=en', {
    waitUntil: 'domcontentloaded',
  });

  await expect(page).toHaveURL(/pages\/instructions\.html/);
  await page.locator('#continueBtn').click();
  await expect(page).toHaveURL(/index\.html/);

  const nextBtn = page.locator('#nextBtn');
  const navSubmitBtn = page.locator('#navSubmitBtn');

  await expect(nextBtn).toBeDisabled();
  await expect(navSubmitBtn).toBeDisabled();

  // Place an activity on the primary (active) timeline
  await placeSingleActivity(page);

  await expect(nextBtn).toBeEnabled();
  await expect(navSubmitBtn).toBeEnabled();

  // Hover over the block while primary is still the active timeline and delete it
  const primaryBlock = page
    .locator('.timeline-container[data-active="true"] .activity-block')
    .first();
  await expect(primaryBlock).toBeVisible();

  await primaryBlock.hover();
  await page.keyboard.press('Delete');

  // Block must be gone
  await expect(
    page.locator('.timeline-container[data-active="true"] .activity-block')
  ).toHaveCount(0);

  // Submit buttons must now be disabled (min coverage no longer met)
  await expect(nextBtn).toBeDisabled();
  await expect(navSubmitBtn).toBeDisabled();
});
