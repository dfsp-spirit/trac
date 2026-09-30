const { test, expect } = require('@playwright/test');
const { MOBILE_VIEWPORT } = require('./participant_pages.js');
const {
  enterStudyIfNeeded,
  placeActivityMobile,
} = require('./e2e_helpers.js');

// The phone context bar replaced two rows of navigation: the row of day buttons
// (#previousDaysSwitchRow is desktop-only now) and the cycling timeline switcher
// button (hidden below the breakpoint). This spec covers what it took over -
// stepping days, jumping to a day, and reaching the second timeline - plus the
// coverage gap that let the original "second timeline is unreachable on a phone"
// bug live: nothing verified that *both* timelines of a day can be filled.
test.use({ viewport: MOBILE_VIEWPORT, hasTouch: true });

async function openDiary(page, pid) {
  await page.goto(`index.html?pid=${pid}&study_name=default&lang=en`, {
    waitUntil: 'load',
  });
  await enterStudyIfNeeded(page);
  await expect(page.locator('#contextBar')).toBeVisible({ timeout: 30000 });
  await expect
    .poll(async () => page.evaluate(() => !!window.timelineManager?.activeTimeline), {
      timeout: 30000,
      message: 'waiting for the timeline to initialize',
    })
    .toBe(true);
}

async function activityCountsByTimeline(page) {
  return page.evaluate(() => {
    const manager = window.timelineManager;
    return Object.fromEntries(
      manager.keys.map((key) => [key, (manager.activities[key] || []).length])
    );
  });
}

async function switchTimelineThroughContextBar(page, index) {
  await page.locator('#timelinePickerBtn').click();
  await expect(page.locator('#timelineMenu')).toBeVisible();
  await page.locator('#timelineMenu .timeline-menu-item').nth(index).click();
  await page.waitForTimeout(600);
}

test('the context bar replaces the day row and the timeline button', async ({
  page,
}) => {
  await openDiary(page, `e2e-context-bar-${Date.now()}`);

  // What the context bar replaced is gone at this width.
  await expect(page.locator('#previousDaysSwitchRow')).toHaveCount(0);
  await expect(page.locator('#switchTimelineBtn')).toBeHidden();
  await expect(page.locator('#saveDayBtn')).toBeVisible();

  // It shows where the participant is, and the arrows name the day they reach.
  await expect(page.locator('#currentDayDisplay')).toBeVisible();
  await expect(page.locator('#dayPickerBtn')).toHaveAttribute(
    'aria-label',
    /Day 1 of 7/
  );
  await expect(page.locator('#prevDayBtn')).toBeDisabled();
  await expect(page.locator('#nextDayBtn')).toBeEnabled();
  await expect(page.locator('#contextTimelineName')).toHaveText('Main Activity');

  // Step to the next day: the arrow saves the current day and navigates.
  await page.locator('#nextDayBtn').click();
  await page.waitForTimeout(1500);
  await expect
    .poll(
      async () => new URL(page.url()).searchParams.get('day_label_index'),
      { timeout: 20000, message: 'waiting for the day to switch' }
    )
    .toBe('1');
  await expect(page.locator('#prevDayBtn')).toBeEnabled();

  // Jump to day 5 from the day menu.
  await page.locator('#dayPickerBtn').click();
  const dayMenu = page.locator('#dayMenu');
  await expect(dayMenu).toBeVisible();
  await expect(dayMenu.locator('.context-menu-header')).toHaveText(
    'Switch to day:'
  );
  await expect(dayMenu.locator('.day-menu-item')).toHaveCount(7);
  // The day being viewed is marked and not selectable.
  await expect(dayMenu.locator('.day-menu-item[aria-current="true"]')).toBeDisabled();
  // Copying a day is reachable from where the target day is chosen.
  await expect(dayMenu.locator('.day-menu-copy')).toHaveText('Copy this day');

  await dayMenu.locator('.day-menu-item').nth(4).click();
  await expect
    .poll(
      async () => new URL(page.url()).searchParams.get('day_label_index'),
      { timeout: 20000, message: 'waiting for the day-menu jump' }
    )
    .toBe('4');

  // Last day: stepping forward is no longer possible.
  await page.locator('#dayPickerBtn').click();
  await page.locator('#dayMenu .day-menu-item').nth(6).click();
  await expect
    .poll(
      async () => new URL(page.url()).searchParams.get('day_label_index'),
      { timeout: 20000, message: 'waiting for the last day' }
    )
    .toBe('6');
  await expect(page.locator('#nextDayBtn')).toBeDisabled();
});

test('the timeline menu lists every timeline with its coverage', async ({
  page,
}) => {
  await openDiary(page, `e2e-timeline-menu-${Date.now()}`);

  await page.locator('#timelinePickerBtn').click();
  const menu = page.locator('#timelineMenu');
  await expect(menu).toBeVisible();
  await expect(menu.locator('.context-menu-header')).toHaveText(
    'Switch timeline'
  );

  // One item per timeline (the study has two) plus "Clear timeline".
  await expect(menu.locator('.timeline-menu-item')).toHaveCount(2);
  await expect(menu.locator('.timeline-menu-item').first()).toBeDisabled();
  // Each entry carries its coverage on a second line: the primary timeline has a
  // min_coverage requirement, the secondary has none (so it reads as met).
  await expect(
    menu.locator('.timeline-menu-item').first().locator('.context-menu-item-detail')
  ).toContainText('required minutes covered');
  await expect(
    menu.locator('.timeline-menu-item').nth(1).locator('.context-menu-item-detail')
  ).toHaveText('✓');

  await menu.locator('.timeline-menu-item').nth(1).click();
  await expect(page.locator('#contextTimelineName')).toHaveText(
    'Secondary Activity'
  );
});

test('both timelines of a phone day survive a save', async ({ page }) => {
  await openDiary(page, `e2e-mobile-both-timelines-${Date.now()}`);

  // Fill the primary timeline.
  await placeActivityMobile(page, 30);

  // Reach the second timeline through the context bar and fill it too - the
  // path that used to be missing entirely on a phone.
  await switchTimelineThroughContextBar(page, 1);
  await placeActivityMobile(page, 60);

  // Key names come from the study config, so assert over both timelines without
  // hard-coding them.
  const beforeSave = await activityCountsByTimeline(page);
  const counts = Object.values(beforeSave);
  expect(counts.length, 'the study has more than one timeline').toBeGreaterThan(1);
  expect(
    counts.every((count) => count > 0),
    `every timeline must hold an activity, got ${JSON.stringify(beforeSave)}`
  ).toBe(true);

  // Save Day stores the whole day, so both timelines must come back.
  await page.locator('#saveDayBtn').click();
  await page.waitForTimeout(6000);
  await enterStudyIfNeeded(page);
  await expect(page.locator('#contextBar')).toBeVisible({ timeout: 30000 });

  await expect
    .poll(async () => activityCountsByTimeline(page), {
      timeout: 20000,
      message: 'waiting for the saved day to load',
    })
    .toEqual(beforeSave);
});
