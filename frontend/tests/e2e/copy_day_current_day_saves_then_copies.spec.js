const { test, expect } = require('@playwright/test');
const { enterStudyIfNeeded } = require('./e2e_helpers.js');

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

async function deleteFirstActiveActivityViaContextMenu(page) {
  const block = page
    .locator('.timeline-container[data-active="true"] .activity-block')
    .first();
  await expect(block).toBeVisible();
  await block.click({ button: 'right' });
  const contextMenu = page.locator('#activityContextMenu');
  await expect(contextMenu).toBeVisible();
  await contextMenu
    .locator('.activity-context-menu-item[data-action="delete"]')
    .click();
  await expect(
    page.locator('.timeline-container[data-active="true"] .activity-block')
  ).toHaveCount(0);
}

test('copy this day: button gates on min coverage, saves before copying, stays on current day', async ({
  page,
}) => {
  await page.goto('index.html?study_name=default&lang=en', {
    waitUntil: 'domcontentloaded',
  });

  await enterStudyIfNeeded(page);

  await expect(page.locator('#currentDayDisplay')).toHaveAttribute(
    'title',
    /Monday/
  );

  const copyButton = page.locator('.copy-day-link');
  const switchRow = page.locator('#previousDaysSwitchRow');

  // Switch row should not be visible yet (no saved day to switch to).
  await expect(switchRow).toHaveCount(0);

  // Initially the current day has no activities → copy button should be
  // visible (the default study has 7 days, so there are empty targets) but
  // disabled, with a "minimum" tooltip, because min coverage is not met.
  await expect(copyButton).toBeVisible();
  await expect(copyButton).toBeDisabled();
  let title = (await copyButton.getAttribute('title')) || '';
  expect(title).toContain('minimum');

  // Place an activity on the primary timeline → min coverage met.
  // updateButtonStates() (called by the create path) must refresh the copy
  // button too, WITHOUT any manual re-render.
  await placeSingleActivity(page);
  await expect(copyButton).toBeEnabled();
  title = (await copyButton.getAttribute('title')) || '';
  expect(title).not.toContain('minimum');

  // Delete the activity → coverage drops below minimum → copy button must
  // become disabled again automatically.
  await deleteFirstActiveActivityViaContextMenu(page);
  await expect(copyButton).toBeDisabled();
  title = (await copyButton.getAttribute('title')) || '';
  expect(title).toContain('minimum');

  // Re-add an activity → coverage met again → copy button enabled.
  await placeSingleActivity(page);
  await expect(copyButton).toBeEnabled();
  title = (await copyButton.getAttribute('title')) || '';
  expect(title).not.toContain('minimum');

  // Open the copy target picker.
  await copyButton.click();

  const picker = page.locator('.copy-day-context-menu');
  await expect(picker).toBeVisible({ timeout: 5000 });

  // The picker must NOT list the current day ("Monday"); the API refuses
  // copying a day onto itself.
  const items = picker.locator('.copy-day-context-menu-item');
  const itemCount = await items.count();
  expect(itemCount).toBeGreaterThan(0);
  for (let i = 0; i < itemCount; i += 1) {
    const text = (await items.nth(i).textContent()) || '';
    expect(text).not.toContain('Monday');
  }

  // Pick a distinct target day, e.g. Wednesday.
  const targetButton = picker
    .locator('.copy-day-context-menu-item')
    .filter({ hasText: 'Wednesday' });
  await expect(targetButton).toHaveCount(1);
  await targetButton.click();

  // A success toast should appear (copyDayTo posts /copy-from after saving
  // the current Monday to the DB).
  const toast = page.locator('.toast, [class*="toast"]');
  await expect
    .poll(
      async () => {
        const visible = await page
          .locator('.toast, [class*="toast"]')
          .first()
          .isVisible()
          .catch(() => false);
        return visible;
      },
      { timeout: 8000, message: 'Waiting for success toast after copy' }
    )
    .toBeTruthy();

  // The copy saved Monday (index 0) and copied it onto Wednesday (index 2),
  // so dayIndicesWithData must now contain both — the save-then-copy flow
  // persists the current day before copying.
  await expect
    .poll(
      async () => page.evaluate(() => window.timelineManager?.dayIndicesWithData || []),
      { timeout: 15000, message: 'Waiting for dayIndicesWithData to include Monday and Wednesday' }
    )
    .toEqual(expect.arrayContaining([0, 2]));

  // We must STILL be on Monday — copying never advances the day.
  await expect(page).toHaveURL(/day_label_index=0/);
  await expect(page.locator('#currentDayDisplay')).toHaveAttribute(
    'title',
    /Monday/
  );

  // Because the switch row now reflects saved days, it must be visible with
  // at least Monday (current, disabled) and Wednesday (enabled) — meaning
  // the day-switch buttons got refreshed as a side effect of the save+copy.
  await expect(switchRow).toBeVisible({ timeout: 10000 });
  await expect(switchRow.locator('button:has-text("Monday")')).toBeVisible();
  await expect(switchRow.locator('button:has-text("Wednesday")')).toBeVisible();

  // Open the picker again — Wednesday is no longer empty, so it must not be
  // listed as a copy target.
  await expect(copyButton).toBeEnabled();
  await copyButton.click();
  await expect(picker).toBeVisible({ timeout: 5000 });
  const wednesdayItems = picker
    .locator('.copy-day-context-menu-item')
    .filter({ hasText: 'Wednesday' });
  await expect(wednesdayItems).toHaveCount(0);
});