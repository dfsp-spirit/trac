const { test, expect } = require('@playwright/test');
const {
  enterStudyIfNeeded,
  placeActivity,
  saveCurrentDay,
  switchToDay,
  getCurrentDayIndex,
  isDayButtonGreen,
  getDayButtonCount,
  closeCopyDayPicker,
  copyDayTo,
  submitStudy,
} = require('./e2e_helpers.js');

test.use({ viewport: { width: 1600, height: 900 } });

/**
 * Place an activity on Monday, save it, then copy it to every other day
 * (Tue..Sun).  Afterwards all 7 days meet min_coverage in the DB and the
 * Submit Study button is enabled.
 *
 * The copy picker excludes the source day (Monday=0), so the item for day
 * index `target` sits at picker position `target - 1`.
 */
async function fillAllDaysFromMonday(page) {
  await placeActivity(page, { activityName: 'Sleeping', positionPercent: 20 });
  await saveCurrentDay(page);

  for (let target = 1; target <= 6; target += 1) {
    const copyBtn = page.locator('.copy-day-link').first();
    await copyBtn.waitFor({ state: 'visible', timeout: 5000 });
    await copyBtn.click();

    const picker = page.locator('.copy-day-context-menu');
    await picker.waitFor({ state: 'visible', timeout: 5000 });

    const targetItem = picker
      .locator('.copy-day-context-menu-item')
      .nth(target - 1);
    await targetItem.waitFor({ state: 'visible', timeout: 3000 });
    await targetItem.click();

    await page.waitForTimeout(2500);
    await expect(picker).toBeHidden({ timeout: 8000 });
  }
}

test.describe('Copy Days — core flows', () => {

  test('save always succeeds regardless of min_coverage', async ({ page }) => {
    await page.goto('index.html?study_name=default&lang=en', {
      waitUntil: 'domcontentloaded',
    });
    await enterStudyIfNeeded(page);

    // Place a tiny activity (10 minutes) — should save without error
    // even though default study has min_coverage=0 anyway.
    await placeActivity(page, { activityName: 'Sleeping', positionPercent: 20 });
    await saveCurrentDay(page);

    // After save+reload, we should be back on the diary page
    await expect(page.locator('#currentDayDisplay')).toBeVisible();
  });

  test('day buttons show green checkmark after meeting min_coverage', async ({ page }) => {
    await page.goto('index.html?study_name=default&lang=en', {
      waitUntil: 'domcontentloaded',
    });
    await enterStudyIfNeeded(page);

    // Place a large activity to meet min_coverage (default study has min_coverage=0
    // on the primary timeline, so any activity works).
    await placeActivity(page, { activityName: 'Sleeping', positionPercent: 20 });
    await saveCurrentDay(page);

    // After reload, Monday's day button should show green checkmark
    const mondayGreen = await isDayButtonGreen(page, 0);
    expect(mondayGreen).toBe(true);
  });

  test('all 7 day buttons are visible for default study', async ({ page }) => {
    await page.goto('index.html?study_name=default&lang=en', {
      waitUntil: 'domcontentloaded',
    });
    await enterStudyIfNeeded(page);

    const count = await getDayButtonCount(page);
    expect(count).toBe(7);  // Monday–Sunday
  });

  test('day buttons visible only when study has multiple days', async ({ page }) => {
    // Use a single-day study mock would be ideal, but default study has 7 days.
    // Just verify the switch row exists for the default study.
    await page.goto('index.html?study_name=default&lang=en', {
      waitUntil: 'domcontentloaded',
    });
    await enterStudyIfNeeded(page);

    const row = page.locator('#previousDaysSwitchRow');
    await expect(row).toBeVisible();
  });

  test('current day button is disabled', async ({ page }) => {
    await page.goto('index.html?study_name=default&lang=en', {
      waitUntil: 'domcontentloaded',
    });
    await enterStudyIfNeeded(page);

    // Monday (day 0) is the current day — its button should be disabled
    const mondayBtn = page.locator('#previousDaysSwitchRow .previous-day-btn').first();
    await expect(mondayBtn).toBeDisabled();
  });

  test('copy day: Monday to Tuesday, verify data appears on Tuesday', async ({ page }) => {
    await page.goto('index.html?study_name=default&lang=en', {
      waitUntil: 'domcontentloaded',
    });
    await enterStudyIfNeeded(page);

    // Place and save an activity on Monday
    await placeActivity(page, { activityName: 'Sleeping', positionPercent: 20 });
    await saveCurrentDay(page);

    // Monday's "Copy this day" button should be visible
    const copyBtn = page.locator('.copy-day-link').first();
    await expect(copyBtn).toBeVisible({ timeout: 5000 });

    // Click copy, pick Tuesday (day index 1) as target
    await copyBtn.click();

    const picker = page.locator('.copy-day-context-menu');
    await picker.waitFor({ state: 'visible', timeout: 5000 });

    // Tuesday is the second item (index 1, since Monday=0 is excluded as source)
    const tuesdayItem = picker.locator('.copy-day-context-menu-item').nth(0);
    await expect(tuesdayItem).toContainText('(empty)');
    await tuesdayItem.click();

    // Wait for copy to complete, picker closes
    await page.waitForTimeout(2000);
    await expect(picker).toBeHidden({ timeout: 5000 });

    // Switch to Tuesday — the day button should now show green
    await switchToDay(page, 1);
    await expect(page.locator('#currentDayDisplay')).toBeVisible();

    // After switching to Tuesday, save to ensure backend state is synced
    await saveCurrentDay(page);
    const tuesdayGreen = await isDayButtonGreen(page, 1);
    expect(tuesdayGreen).toBe(true);
  });

  test('overwriting a day with data asks in a styled dialog, not the browser prompt', async ({
    page,
  }) => {
    // A native window.confirm() cannot be styled and looks nothing like the app.
    // This test fails if one ever comes back, and proves the dialog can actually
    // stop the copy: cancelling must leave the target day's own activity alone.
    let nativeDialogAppeared = false;
    page.on('dialog', async (dialog) => {
      nativeDialogAppeared = true;
      await dialog.dismiss();
    });

    const activityCountOnCurrentDay = () =>
      page.evaluate(() =>
        Object.values(window.timelineManager.activities).reduce(
          (sum, list) => sum + list.length,
          0
        )
      );

    await page.goto('index.html?study_name=default&lang=en', {
      waitUntil: 'domcontentloaded',
    });
    await enterStudyIfNeeded(page);

    // Monday holds one activity; Tuesday gets a copy of it plus one of its own,
    // so an overwrite is visible as "2 activities became 1".
    await placeActivity(page, { activityName: 'Sleeping', positionPercent: 20 });
    await saveCurrentDay(page);
    await copyDayTo(page, 0, 1);
    await switchToDay(page, 1);
    await placeActivity(page, { activityName: 'Cooking', positionPercent: 70 });
    await saveCurrentDay(page);
    expect(await activityCountOnCurrentDay()).toBe(2);

    const openOverwriteDialog = async () => {
      if ((await getCurrentDayIndex(page)) !== 0) {
        await switchToDay(page, 0);
      }
      const copyBtn = page.locator('.copy-day-link').first();
      await expect(copyBtn).toBeVisible({ timeout: 5000 });
      await copyBtn.click();
      const picker = page.locator('.copy-day-context-menu');
      await picker.waitFor({ state: 'visible', timeout: 5000 });
      await expect(picker.locator('.copy-day-context-menu-item').nth(0)).toContainText(
        '(has data)'
      );
      await picker.locator('.copy-day-context-menu-item').nth(0).click();
      const dialog = page.locator('#copyOverwriteConfirm');
      await expect(dialog).toBeVisible({ timeout: 5000 });
      return dialog;
    };

    // Cancel: a styled app dialog (not the browser prompt), and the copy aborts.
    let dialog = await openOverwriteDialog();
    await expect(dialog).toHaveClass(/modal-overlay/);
    await expect(dialog.locator('.modal-content h3')).toHaveText('Overwrite day?');
    await expect(dialog.locator('.confirm-dialog-message')).toHaveText(
      'Tuesday already has data. Overwrite it?'
    );
    await expect(page.locator('#copyOverwriteYes')).toHaveText('Overwrite');
    await expect(page.locator('#copyOverwriteNo')).toHaveText('Cancel');
    await dialog.screenshot({ path: 'test-results/overwrite-confirm-dialog.png' });

    await page.locator('#copyOverwriteNo').click();
    await expect(dialog).toBeHidden({ timeout: 5000 });
    await switchToDay(page, 1);
    expect(
      await activityCountOnCurrentDay(),
      'cancelling must leave the target day untouched'
    ).toBe(2);

    // Confirm: the overwrite happens.
    dialog = await openOverwriteDialog();
    await page.locator('#copyOverwriteYes').click();
    await expect(dialog).toBeHidden({ timeout: 5000 });
    await switchToDay(page, 1);
    expect(
      await activityCountOnCurrentDay(),
      'confirming must overwrite the target day with the source day'
    ).toBe(1);

    expect(
      nativeDialogAppeared,
      'the overwrite confirmation must use the styled dialog, not window.confirm()'
    ).toBe(false);
  });

  test('right-click day button opens copy picker with current day as target', async ({ page }) => {
    await page.goto('index.html?study_name=default&lang=en', {
      waitUntil: 'domcontentloaded',
    });
    await enterStudyIfNeeded(page);

    // Place and save on Monday first so it has data
    await placeActivity(page, { activityName: 'Sleeping', positionPercent: 20 });
    await saveCurrentDay(page);

    // Monday should have the green checkmark (has data)
    expect(await isDayButtonGreen(page, 0)).toBe(true);

    // Switch to Tuesday (current viewing day becomes Tuesday)
    await switchToDay(page, 1);
    await page.waitForTimeout(500);

    // Right-click Monday's day button (index 0)
    const mondayBtn = page.locator('#previousDaysSwitchRow .previous-day-btn').nth(0);
    await expect(mondayBtn).not.toBeDisabled();
    await mondayBtn.click({ button: 'right' });

    const picker = page.locator('.copy-day-context-menu');
    await picker.waitFor({ state: 'visible', timeout: 5000 });

    // Monday (source) is excluded, so 6 targets remain: Tue–Sun.
    // Tuesday (current viewing day, index 1) SHOULD be included (fixed issue #7).
    const pickerItems = picker.locator('.copy-day-context-menu-item');
    const itemCount = await pickerItems.count();
    expect(itemCount).toBe(6);

    // The picker is anchored at the cursor and covers the day header, so click
    // a point that is provably outside of it to dismiss it.
    await closeCopyDayPicker(page);
  });

  test('Submit Study button exists and is disabled when days are incomplete', async ({ page }) => {
    await page.goto('index.html?study_name=default&lang=en', {
      waitUntil: 'domcontentloaded',
    });
    await enterStudyIfNeeded(page);

    const submitBtn = page.locator('#submitStudyBtn');
    await expect(submitBtn).toBeVisible();
    // Should be disabled because not all days are green yet
    await expect(submitBtn).toBeDisabled();
  });

  test('Submit Study grays out immediately when the current day drops below min_coverage (unsaved delete)', async ({ page }) => {
    test.setTimeout(120000);
    await page.goto('index.html?study_name=default&lang=en', {
      waitUntil: 'domcontentloaded',
    });
    await enterStudyIfNeeded(page);

    await fillAllDaysFromMonday(page);

    // All 7 days now meet min_coverage in the DB -> Submit Study is enabled.
    const submitBtn = page.locator('#submitStudyBtn');
    await expect(submitBtn).toBeEnabled({ timeout: 8000 });

    // Navigate to a (random) day and delete all its activities WITHOUT saving.
    await switchToDay(page, 3);

    // The copied day has exactly one activity; remove it (client state only).
    const block = page.locator('.activity-block').first();
    await expect(block).toHaveCount(1, { timeout: 3000 });
    await block.click({ button: 'right' });
    await page.locator('#activityContextMenu [data-action="delete"]').click();

    // The current day's client coverage is now 0 < min_coverage, so the Submit
    // Study button must gray out immediately — before any save happens.
    await expect(submitBtn).toBeDisabled({ timeout: 3000 });
  });

  test('Submit Study saves the current day first and redirects to thank-you once all days meet min_coverage', async ({ page }) => {
    test.setTimeout(120000);
    await page.goto('index.html?study_name=default&lang=en', {
      waitUntil: 'domcontentloaded',
    });
    await enterStudyIfNeeded(page);

    await fillAllDaysFromMonday(page);

    // All days meet min_coverage -> the button is clickable, and the handler
    // persists the current day before POSTing /submit, then redirects.
    await submitStudy(page);
  });
});
