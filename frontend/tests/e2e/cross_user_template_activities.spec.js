/**
 * E2E test: cross-user activity copy via ?template_user=<pid> URL parameter.
 *
 * Architecture
 * ------------
 *  When a target user visits with ?template_user=<pid>, the frontend POSTs to
 *  /api/template-activities which copies all source-user activities directly into the
 *  database for the target user (skipping days where the target already has data).
 *  The subsequent normal GET then loads those copied activities as regular DB activities —
 *  no separate "template" concept in the frontend at all.
 *
 * Scenario
 * --------
 *  Source user (pid1)
 *    - Monday  : 1 activity placed at ~25 %
 *    - Tuesday : 2 activities placed at ~25 % and ~75 %
 *    Both days are saved by submitting.
 *
 *  Target user (pid2) visits with ?template_user=pid1
 *    - Monday  : POST copy runs, then regular GET loads 1 activity on primary timeline.
 *    - Switches to Tuesday via the day-switch row button.
 *    - Tuesday : regular GET loads 2 activities — NOT 1 (which would mean Monday data
 *                was loaded instead of Tuesday).
 */

const { test, expect } = require('@playwright/test');

test.use({ viewport: { width: 1600, height: 900 } });

// ---------------------------------------------------------------------------
// Helpers shared across both phases
// ---------------------------------------------------------------------------

async function waitForActivitiesLoaded(page) {
  await expect
    .poll(
      async () => page.locator('#activitiesContainer .activity-button').count(),
      {
        timeout: 30_000,
        message: 'Waiting for activity buttons to load from backend',
      }
    )
    .toBeGreaterThan(0);
}

/**
 * Click an hour-marker on the active timeline that is closest to `targetPercent`.
 * Uses a synthetic MouseEvent so interact.js / the drag lib does not interfere.
 */
async function clickTimelineAtPercent(page, targetPercent) {
  const activeTimeline = page.locator(
    '.timeline-container[data-active="true"]'
  );
  await expect(activeTimeline).toBeVisible();

  const timelineElement = activeTimeline.locator('.timeline').first();
  await expect(timelineElement).toBeVisible();

  const box = await timelineElement.boundingBox();
  if (!box) {
    throw new Error('Active timeline bounding box is not available');
  }

  const clampedPercent = Math.max(1, Math.min(99, targetPercent));
  const clickX = box.x + (box.width * clampedPercent) / 100;
  const clickY = box.y + box.height * 0.5;

  await page.mouse.click(clickX, clickY);
}

/**
 * Select the first simple activity button (no child-item dropdown, no custom text input)
 * and place it on the active primary timeline at `percent`.
 */
async function placeSimpleActivityAtPercent(page, percent) {
  await waitForActivitiesLoaded(page);

  const simpleActivity = page
    .locator('#activitiesContainer .activity-button:visible')
    .filter({
      hasNot: page.locator('.child-items-indicator, .custom-input-indicator'),
    })
    .first();

  // Fall back to any visible activity button that has no dropdown/pencil markers in its
  // own classes (works for the default activity set used in CI).
  const candidate = page
    .locator(
      '#activitiesContainer .activity-button:visible:not(.has-child-items):not(.custom-input)'
    )
    .first();

  await expect(candidate).toBeVisible({ timeout: 15_000 });
  await candidate.click();
  await clickTimelineAtPercent(page, percent);
}

/**
 * Submit the current day and wait until the URL reflects `expectedDayIndex`.
 * Handles the optional confirmation modal that appears before saving.
 */
async function submitDayAndWaitForIndex(page, expectedDayIndex) {
  const submitBtn = page.locator('#navSubmitBtn');
  const confirmModal = page.locator('#confirmationModal');

  await expect(submitBtn).toBeVisible({ timeout: 15_000 });
  await expect(submitBtn).toBeEnabled();

  for (let attempt = 0; attempt < 4; attempt += 1) {
    await submitBtn.click();

    if (await confirmModal.isVisible()) {
      await page.locator('#confirmOk').click();
      break;
    }

    const idx = Number(
      new URL(page.url()).searchParams.get('day_label_index') || 0
    );
    if (idx === expectedDayIndex) break;

    await page.waitForTimeout(600);
  }

  await expect
    .poll(
      async () =>
        Number(new URL(page.url()).searchParams.get('day_label_index') || 0),
      {
        timeout: 30_000,
        message: `Waiting for day_label_index=${expectedDayIndex}`,
      }
    )
    .toBe(expectedDayIndex);
}

/**
 * Count activity blocks on the *primary* timeline by reading timelineManager state.
 * This is more reliable than counting DOM elements that may still be rendering.
 */
async function getPrimaryActivityCount(page) {
  return page.evaluate(
    () => (window.timelineManager?.activities?.primary || []).length
  );
}

async function clearCurrentRow(page) {
  const cleanRowBtn = page.locator('#cleanRowBtn');
  const cleanRowConfirmationModal = page.locator('#cleanRowConfirmationModal');
  const confirmCleanRowOkBtn = page.locator('#confirmCleanRowOk');

  await expect(cleanRowBtn).toBeVisible({ timeout: 15_000 });
  await expect(cleanRowBtn).toBeEnabled();
  await cleanRowBtn.click();

  await expect(cleanRowConfirmationModal).toBeVisible({ timeout: 10_000 });
  await expect(confirmCleanRowOkBtn).toBeVisible();
  await confirmCleanRowOkBtn.click();

  await expect
    .poll(async () => getPrimaryActivityCount(page), {
      timeout: 10_000,
      message: 'Waiting for current row to be cleared',
    })
    .toBe(0);
}

// ---------------------------------------------------------------------------
// Test
// ---------------------------------------------------------------------------

test('cross-user template copies correct per-day activities to target user', async ({
  page,
}) => {
  // Generate unique participant IDs so parallel test runs never collide.
  const uniqueSuffix = `${Date.now()}-${Math.floor(Math.random() * 1_000_000)}`;
  const pid1 = `trac-e2e-src-${uniqueSuffix}`;
  const pid2 = `trac-e2e-tgt-${uniqueSuffix}`;

  // -----------------------------------------------------------------------
  // PHASE 1 – source user fills Monday (1 activity) and Tuesday (2 activities)
  // -----------------------------------------------------------------------

  await page.goto(`index.html?study_name=default&lang=en&pid=${pid1}`, {
    waitUntil: 'domcontentloaded',
  });
  await expect(page).toHaveURL(/pages\/instructions\.html/);
  await page.locator('#continueBtn').click();
  await expect(page).toHaveURL(/index\.html/);

  // ---- Monday (day_label_index = 0) ----
  await expect(page.locator('#currentDayDisplay')).toHaveAttribute(
    'title',
    /Monday/,
    { timeout: 30_000 }
  );

  await placeSimpleActivityAtPercent(page, 25);

  // Verify 1 block placed before submitting.
  await expect(
    page.locator('.timeline-container[data-active="true"] .activity-block')
  ).toHaveCount(1);

  await submitDayAndWaitForIndex(page, 1); // submit Monday → Tuesday

  // ---- Tuesday (day_label_index = 1) ----
  await expect(page.locator('#currentDayDisplay')).toHaveAttribute(
    'title',
    /Tuesday/,
    { timeout: 30_000 }
  );

  // Tuesday may be prefilled from Monday template for the same user.
  // Start from a clean row so source data is deterministic: exactly 2 activities on Tuesday.
  await clearCurrentRow(page);

  await placeSimpleActivityAtPercent(page, 25); // first activity at 25 %
  await placeSimpleActivityAtPercent(page, 75); // second activity at 75 %

  // Verify exactly 2 timeline activities in state before submitting.
  await expect
    .poll(async () => getPrimaryActivityCount(page), {
      timeout: 15_000,
      message:
        'Waiting for exactly 2 source activities on Tuesday before submit',
    })
    .toBe(2);

  await submitDayAndWaitForIndex(page, 2); // submit Tuesday → Wednesday (day 2)

  // -----------------------------------------------------------------------
  // PHASE 2 – target user arrives with template_user=pid1
  //
  // init() POSTs to /api/template-activities which copies pid1's activities to pid2's DB
  // rows.  The subsequent regular GET then loads them as normal activities.
  // -----------------------------------------------------------------------

  await page.goto(
    `index.html?study_name=default&lang=en&pid=${pid2}&template_user=${pid1}`,
    { waitUntil: 'domcontentloaded' }
  );
  await expect(page).toHaveURL(/pages\/instructions\.html/);
  await page.locator('#continueBtn').click();
  await expect(page).toHaveURL(/index\.html/);

  // Should land on Monday (day_label_index = 0).
  await expect(page.locator('#currentDayDisplay')).toHaveAttribute(
    'title',
    /Monday/,
    { timeout: 30_000 }
  );

  // Wait for the copied Monday activity to be loaded from the DB by the regular GET.
  await expect
    .poll(async () => getPrimaryActivityCount(page), {
      timeout: 30_000,
      message: 'Waiting for Monday copied activity to load for target user',
    })
    .toBe(1);

  // Day-switch row must show Tuesday as a navigable day (backend returns day_indices_with_data
  // including Tuesday because activities were copied there too).
  const switchRow = page.locator('#previousDaysSwitchRow');
  await expect(switchRow).toBeVisible({ timeout: 30_000 });

  const tuesdayBtn = switchRow
    .locator('.previous-day-btn')
    .filter({ hasText: 'Tuesday' });
  await expect(tuesdayBtn).toBeVisible({ timeout: 15_000 });

  // ---- Navigate to Tuesday via the day-switch button ----
  await tuesdayBtn.click();

  await expect
    .poll(
      async () =>
        Number(new URL(page.url()).searchParams.get('day_label_index') || 0),
      { timeout: 30_000, message: 'Waiting for day_label_index=1 (Tuesday)' }
    )
    .toBe(1);

  await expect(page.locator('#currentDayDisplay')).toHaveAttribute(
    'title',
    /Tuesday/,
    { timeout: 30_000 }
  );

  // Tuesday for target user must have EXACTLY 2 activities (copied from source user's Tuesday),
  // not 1 (which would indicate only Monday data was copied or the wrong day was loaded).
  await expect
    .poll(async () => getPrimaryActivityCount(page), {
      timeout: 30_000,
      message:
        'Waiting for exactly 2 Tuesday copied activities for target user',
    })
    .toBe(2);
});
