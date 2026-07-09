const { test, expect } = require('@playwright/test');
const { enterStudyIfNeeded } = require('./e2e_helpers.js');

test.use({ viewport: { width: 1600, height: 900 } });

// --- helpers ---

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

async function getCurrentTimelineKey(page) {
  return page.evaluate(
    () => window.timelineManager.keys[window.timelineManager.currentIndex]
  );
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

async function selectFirstVisibleActivity(page) {
  await waitForActivitiesLoaded(page);

  const placeable = page.locator(
    '#activitiesContainer .activity-button:visible:not(.has-child-items):not(.custom-input)'
  );

  if ((await placeable.count()) > 0) {
    await placeable.first().click();
    await expect
      .poll(async () => page.evaluate(() => !!window.selectedActivity), {
        timeout: 3000,
        message: 'Waiting for selected activity state after button click',
      })
      .toBeTruthy();
    return;
  }

  await page
    .locator('#activitiesContainer .activity-button:visible')
    .first()
    .click();
  await expect
    .poll(async () => page.evaluate(() => !!window.selectedActivity), {
      timeout: 3000,
      message: 'Waiting for selected activity state after fallback click',
    })
    .toBeTruthy();
}

async function addActivityAtPercent(page, percent) {
  await selectFirstVisibleActivity(page);
  await clickTimelineAtPercent(page, percent);

  await expect(
    page.locator('.timeline-container[data-active="true"] .activity-block')
  ).not.toHaveCount(0);
}

async function switchToDay(page, dayName) {
  const switchRow = page.locator('#previousDaysSwitchRow');
  await expect(switchRow).toBeVisible({ timeout: 30000 });

  const targetBtn = switchRow.locator('.previous-day-btn', {
    hasText: dayName,
  });
  await expect(targetBtn).toBeEnabled();
  await targetBtn.click();

  // Wait for page navigation to complete
  await page.waitForLoadState('domcontentloaded');
  await enterStudyIfNeeded(page);

  await expect(page.locator('#currentDayDisplay')).toHaveAttribute(
    'title',
    new RegExp(dayName),
    { timeout: 30000 }
  );
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

  await expect(currentDayDisplay).toHaveAttribute(
    'title',
    new RegExp(expectedNextDayName),
    { timeout: 30000 }
  );
}

async function getActivityBlockAtPosition(page, positionIndex) {
  const blocks = page.locator(
    '.timeline-container[data-active="true"] .activity-block'
  );
  return blocks.nth(positionIndex);
}

/**
 * Press an arrow key on a focused activity block and verify that
 * the block does NOT receive the 'invalid' class (shake animation).
 */
async function resizeBlockWithArrowKey(
  page,
  block,
  key,
  expectedBlockCount
) {
  await block.focus();

  // record the block's current bounding box
  const beforeBox = await block.boundingBox();

  await page.keyboard.press(key);
  await page.waitForTimeout(200);

  // The block must NOT have the invalid class
  const hasInvalid = await block.evaluate((el) =>
    el.classList.contains('invalid')
  );
  expect(hasInvalid).toBe(false);

  // Optionally verify that the block count didn't change
  const blocks = page.locator(
    '.timeline-container[data-active="true"] .activity-block'
  );
  await expect(blocks).toHaveCount(expectedBlockCount);

  return beforeBox;
}

// --- test ---

test('can edit activity times after switching back to a previous day', async ({
  page,
}) => {
  // Use 15-year-olds study as specified
  await page.goto('index.html?study_name=15yearolds&lang=en', {
    waitUntil: 'domcontentloaded',
  });

  // Go through consent and instructions
  await enterStudyIfNeeded(page);
  await expect(page).toHaveURL(/index\.html/);
  await expect(page.locator('#currentDayDisplay')).toHaveAttribute(
    'title',
    /Monday/
  );

  // --- Monday: place activities on primary timeline ---

  // Place first activity ("Sleeping") on primary timeline at ~15% (around 07:00)
  await addActivityAtPercent(page, 15);
  let primaryBlocks = page.locator(
    '.timeline-container[data-active="true"] .activity-block'
  );
  await expect(primaryBlocks).toHaveCount(1);

  // Place second activity ("Streaming video" or similar) at ~80% (around 22:00)
  // to cover most of the remaining day
  await addActivityAtPercent(page, 80);
  await expect(primaryBlocks).toHaveCount(2);

  // --- Switch to secondary timeline and place an activity ---

  const nextBtn = page.locator('#nextBtn');
  await expect(nextBtn).toBeVisible();
  await expect(nextBtn).toBeEnabled();
  await nextBtn.click();
  await page.waitForTimeout(700);

  // Wait until we're on the secondary timeline
  await expect
    .poll(async () => getCurrentTimelineKey(page), {
      timeout: 10000,
      message: 'Waiting for secondary timeline',
    })
    .toBe('secondary');

  // Place activity on secondary timeline at ~50%
  await addActivityAtPercent(page, 50);
  let secondaryBlocks = page.locator(
    '.timeline-container[data-active="true"] .activity-block'
  );
  await expect(secondaryBlocks).toHaveCount(1);

  // --- Submit Monday, arrive at Tuesday ---
  await submitCurrentDay(page, 'Tuesday');

  // --- Verify we are on Tuesday ---
  await expect(page.locator('#currentDayDisplay')).toHaveAttribute(
    'title',
    /Tuesday/
  );

  // --- Switch back to Monday ---
  await switchToDay(page, 'Monday');

  // --- Verify we're back on Monday with primary timeline ---
  await expect(page.locator('#currentDayDisplay')).toHaveAttribute(
    'title',
    /Monday/
  );

  // Wait for primary timeline activities to be rendered
  await expect
    .poll(
      async () => {
        return page.evaluate(() => {
          const primary =
            window.timelineManager.activities['primary'] || [];
          return primary.length;
        });
      },
      { timeout: 15000, message: 'Waiting for primary activities to load' }
    )
    .toBe(2);

  primaryBlocks = page.locator(
    '.timeline-container[data-active="true"] .activity-block'
  );
  await expect(primaryBlocks).toHaveCount(2);

  // --- Try editing activity times with arrow keys ---

  // Edit the first activity: try Left arrow (shrink end time)
  const firstBlock = await getActivityBlockAtPosition(page, 0);
  await resizeBlockWithArrowKey(page, firstBlock, 'ArrowLeft', 2);

  // Edit the first activity: try Right arrow (extend end time)
  await resizeBlockWithArrowKey(page, firstBlock, 'ArrowRight', 2);

  // Edit the first activity: try Up arrow (shrink start time)
  await resizeBlockWithArrowKey(page, firstBlock, 'ArrowUp', 2);

  // Edit the first activity: try Down arrow (extend start time)
  await resizeBlockWithArrowKey(page, firstBlock, 'ArrowDown', 2);

  // Edit the second activity: try Left arrow
  const secondBlock = await getActivityBlockAtPosition(page, 1);
  await resizeBlockWithArrowKey(page, secondBlock, 'ArrowLeft', 2);

  // Edit the second activity: try Right arrow
  await resizeBlockWithArrowKey(page, secondBlock, 'ArrowRight', 2);

  // --- Also verify secondary timeline activities can be edited ---

  // Switch to secondary timeline
  await nextBtn.click();
  await page.waitForTimeout(700);

  await expect
    .poll(async () => getCurrentTimelineKey(page), {
      timeout: 10000,
      message: 'Waiting for secondary timeline on Monday',
    })
    .toBe('secondary');

  secondaryBlocks = page.locator(
    '.timeline-container[data-active="true"] .activity-block'
  );
  await expect(secondaryBlocks).toHaveCount(1);

  const secBlock = await getActivityBlockAtPosition(page, 0);
  await resizeBlockWithArrowKey(page, secBlock, 'ArrowLeft', 1);
  await resizeBlockWithArrowKey(page, secBlock, 'ArrowRight', 1);
  await resizeBlockWithArrowKey(page, secBlock, 'ArrowUp', 1);
  await resizeBlockWithArrowKey(page, secBlock, 'ArrowDown', 1);
});
