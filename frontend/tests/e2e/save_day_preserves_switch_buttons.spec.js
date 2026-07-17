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

test('save-day on last day preserves day-switch buttons after reload', async ({
  page,
}) => {
  // ── 1. Enter the default study ──────────────────────────────────────────
  await page.goto('index.html?study_name=default&lang=en', {
    waitUntil: 'domcontentloaded',
  });
  await enterStudyIfNeeded(page);

  await expect(page.locator('#currentDayDisplay')).toHaveAttribute(
    'title',
    /Monday/
  );

  const switchRow = page.locator('#previousDaysSwitchRow');

  // ── 2. Place an activity (Sleeping) to meet min_coverage ────────────────
  await placeSingleActivity(page);

  // The "Copy this day" button must now be enabled.
  const copyButton = page.locator('.copy-day-link');
  await expect(copyButton).toBeEnabled({ timeout: 5000 });

  // ── 3. Copy Monday → Sunday (the last study day, index 6) ───────────────
  await copyButton.click();

  const picker = page.locator('.copy-day-context-menu');
  await expect(picker).toBeVisible({ timeout: 5000 });

  const sundayTarget = picker
    .locator('.copy-day-context-menu-item')
    .filter({ hasText: 'Sunday' });
  await expect(sundayTarget).toHaveCount(1);
  await sundayTarget.click();

  // Wait for the success toast.
  await expect
    .poll(
      async () =>
        page.locator('.toast, [class*="toast"]').first().isVisible().catch(() => false),
      { timeout: 8000, message: 'Waiting for success toast after copy' }
    )
    .toBeTruthy();

  // ── 4. Verify switch row now shows Monday + Sunday ─────────────────────
  await expect(switchRow).toBeVisible({ timeout: 10000 });
  await expect(switchRow.locator('button:has-text("Monday")')).toBeVisible();
  await expect(switchRow.locator('button:has-text("Sunday")')).toBeVisible();

  // ── 5. Switch to Sunday ─────────────────────────────────────────────────
  const sundaySwitchBtn = switchRow.locator('button:has-text("Sunday")');
  await expect(sundaySwitchBtn).toBeEnabled();
  await sundaySwitchBtn.click();

  // Wait for navigation to Sunday (day_label_index=6).
  await expect(page).toHaveURL(/day_label_index=6/, { timeout: 15000 });
  await page.waitForLoadState('domcontentloaded');

  await expect(page.locator('#currentDayDisplay')).toHaveAttribute(
    'title',
    /Sunday/
  );

  // ── 6. After reload, switch row must STILL show Monday + Sunday ─────────
  await expect(switchRow).toBeVisible({ timeout: 10000 });
  const mondayBtnAfterSwitch = switchRow.locator('button:has-text("Monday")');
  await expect(mondayBtnAfterSwitch).toBeVisible();
  await expect(mondayBtnAfterSwitch).toBeEnabled();

  const sundayBtnAfterSwitch = switchRow.locator('button:has-text("Sunday")');
  await expect(sundayBtnAfterSwitch).toBeVisible();
  // Sunday is the current day → should be disabled with aria-current.
  await expect(sundayBtnAfterSwitch).toBeDisabled();
  await expect(sundayBtnAfterSwitch).toHaveAttribute('aria-current', 'date');

  // ── 7. Place an activity on Sunday to meet min_coverage ─────────────────
  await placeSingleActivity(page);

  // ── 8. The default study has TWO timelines (primary + secondary).
  //      Advance to the secondary timeline before "Save Day" appears.
  const nextBtn = page.locator('#nextBtn');
  await expect(nextBtn).toBeVisible();
  await expect(nextBtn).toBeEnabled();

  const initialMode = await nextBtn.getAttribute('data-mode');
  const initialText = (await nextBtn.textContent()) || '';

  // If already on the last timeline, button should say "Save Day" /
  // "Submit Day".  Otherwise click through timelines until we reach
  // the last one.
  if (initialMode !== 'save-day' && initialMode !== 'finish-study' && initialMode !== 'submit-day') {
    await nextBtn.click();
    // Wait for the timeline to advance — button mode must change.
    await expect
      .poll(
        async () => nextBtn.getAttribute('data-mode'),
        { timeout: 10000, message: 'Waiting for data-mode to change after Next Timeline click' }
      )
      .not.toBe('next');
  }

  // Now the button should be on the last timeline (secondary).
  const modeBeforeClick = await nextBtn.getAttribute('data-mode');
  const textBeforeClick = (await nextBtn.textContent()) || '';
  console.log(`Button mode: ${modeBeforeClick}, text: "${textBeforeClick}"`);

  // Allow the 500ms cooldown between clicks to clear.
  await page.waitForTimeout(600);

  // Click the save/submit button.
  await nextBtn.click();

  // Confirm the modal.
  const confirmationModal = page.locator('#confirmationModal');
  await expect(confirmationModal).toBeVisible({ timeout: 5000 });
  await page.locator('#confirmOk').click();

  // Wait for the save toast and page reload.
  await expect
    .poll(
      async () =>
        page.locator('.toast, [class*="toast"]').first().isVisible().catch(() => false),
      { timeout: 8000, message: 'Waiting for save toast after Save Day' }
    )
    .toBeTruthy();

  // Wait for the reload — the page will go through full init() again.
  await page.waitForLoadState('domcontentloaded');

  // After reload we should still be on Sunday.
  await expect(page.locator('#currentDayDisplay')).toHaveAttribute(
    'title',
    /Sunday/
  );

  // ── 9. THE BUG CHECK: switch row MUST be visible after save+reload ──────
  //      It should still show Monday (has data) and Sunday (current, disabled).
  await expect(switchRow).toBeVisible({ timeout: 15000 });

  const mondayAfterSave = switchRow.locator('button:has-text("Monday")');
  await expect(mondayAfterSave).toBeVisible({ timeout: 5000 });
  await expect(mondayAfterSave).toBeEnabled();

  const sundayAfterSave = switchRow.locator('button:has-text("Sunday")');
  await expect(sundayAfterSave).toBeVisible();
  await expect(sundayAfterSave).toBeDisabled();
  await expect(sundayAfterSave).toHaveAttribute('aria-current', 'date');

  // ── 10. Also verify dayIndicesWithData has both days ────────────────────
  await expect
    .poll(
      async () =>
        page.evaluate(
          () => window.timelineManager?.dayIndicesWithData || []
        ),
      {
        timeout: 10000,
        message: 'Waiting for dayIndicesWithData to contain Monday (0) and Sunday (6)',
      }
    )
    .toEqual(expect.arrayContaining([0, 6]));
});
