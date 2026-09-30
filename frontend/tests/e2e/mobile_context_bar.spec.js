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
  // Copying is a day-pair action on the day the participant is in, not a day to
  // jump to - so it is the first row, above the list, names the day it acts on
  // and carries a copy glyph. As the last row of the list it read as an eighth
  // day and nobody found it.
  await expect(dayMenu.locator('.context-menu-item').first()).toHaveClass(
    /day-menu-copy/
  );
  // (The row carries a second line on an empty day - "Source day has no
  // activities to copy." - so assert the label prefix, not the whole text.)
  await expect(dayMenu.locator('.day-menu-copy')).toContainText(
    /^Copy Tuesday to another day/
  );
  await expect(
    dayMenu.locator('.day-menu-copy .context-menu-item-icon')
  ).toHaveClass(/fa-copy/);
  // It sits above the "Switch to day:" header, i.e. outside the day list.
  const copyIsAboveDayList = await dayMenu.evaluate((menu) => {
    const rows = Array.from(menu.children);
    return (
      rows.findIndex((row) => row.classList.contains('day-menu-copy')) <
      rows.findIndex((row) => row.classList.contains('context-menu-header'))
    );
  });
  expect(copyIsAboveDayList).toBe(true);

  // This day is empty, so the row is disabled and greyed - but it is still
  // there: seeing it is how a participant learns that copying exists (hiding it
  // hides the feature), and the reason is written on the row rather than hidden
  // behind a tap, so nothing silently does nothing.
  const copyRow = dayMenu.locator('.day-menu-copy');
  await expect(copyRow).toBeDisabled();
  await expect(copyRow).toContainText('Source day has no activities to copy');

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

  // Save Day stores the whole day, so both timelines must come back. Saving no
  // longer reloads the page, so reload explicitly here: that is the point of this
  // test (the day must come back from the backend, not from memory).
  const saved = page.waitForResponse(
    (response) =>
      response.request().method() === 'POST' &&
      /\/activities(\?|$)/.test(response.url()) &&
      response.status() >= 200 &&
      response.status() < 300,
    { timeout: 30000 }
  );
  await page.locator('#saveDayBtn').click();
  await saved;
  await page.reload({ waitUntil: 'load' });
  await enterStudyIfNeeded(page);
  await expect(page.locator('#contextBar')).toBeVisible({ timeout: 30000 });

  await expect
    .poll(async () => activityCountsByTimeline(page), {
      timeout: 20000,
      message: 'waiting for the saved day to load',
    })
    .toEqual(beforeSave);
});

test('the copy row is active on a filled day and offers the jump to the target', async ({
  page,
}) => {
  await openDiary(page, `e2e-day-sheet-copy-${Date.now()}`);

  // Fill Monday, so there is something to copy and the row must be active.
  await placeActivityMobile(page, 30);
  // Timeline key names come from the study config, so count over all of them.
  const totalActivities = async () =>
    Object.values(await activityCountsByTimeline(page)).reduce(
      (sum, count) => sum + count,
      0
    );
  await expect
    .poll(totalActivities, {
      timeout: 15000,
      message: 'waiting for the activity to land',
    })
    .toBeGreaterThan(0);

  await page.locator('#dayPickerBtn').click();
  const copyRow = page.locator('#dayMenu .day-menu-copy');
  await expect(copyRow).toBeVisible();
  await expect(copyRow).toBeEnabled();
  await expect(copyRow).not.toContainText('no activities to copy');

  await copyRow.click();
  const picker = page.locator('.copy-day-context-menu');
  await expect(picker).toBeVisible();
  await expect(picker.locator('.context-menu-header')).toContainText(
    'Copy to another day: Monday'
  );
  // Targets exclude the day being viewed and say whether they would be
  // overwritten.
  await expect(picker.locator('.context-menu-item').first()).toHaveText(
    'Tuesday (empty)'
  );

  await picker.locator('.context-menu-item').first().click();

  // Copying persists the source day and stays on it, so the toast offers the
  // jump instead of dumping the participant back where they started.
  const toast = page.locator('.toast');
  await expect(toast).toBeVisible({ timeout: 20000 });
  await expect(toast).toContainText('Copied Monday to Tuesday');
  const jump = toast.locator('.toast-action');
  await expect(jump).toHaveText('Go to Tuesday');

  await jump.click();

  // The action switches to the copied day, which now holds the activities.
  await expect
    .poll(
      async () => new URL(page.url()).searchParams.get('day_label_index'),
      { timeout: 30000, message: 'waiting for the jump to the copied day' }
    )
    .toBe('1');
  await expect(page.locator('#contextBar')).toBeVisible({ timeout: 30000 });
  await expect
    .poll(totalActivities, {
      timeout: 20000,
      message: 'waiting for the copied day to load',
    })
    .toBeGreaterThan(0);
});
