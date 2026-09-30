const { expect } = require('@playwright/test');

function isInstructionsUrl(url) {
  return /pages\/instructions\.html/.test(url);
}

function isConsentUrl(url) {
  return /pages\/consent\.html/.test(url);
}

function isIndexUrl(url) {
  return /index\.html/.test(url);
}

function isTransientNavigationError(error) {
  const message = String(error?.message || '');
  return (
    message.includes('WebKit encountered an internal error') ||
    message.includes('Target page, context or browser has been closed') ||
    message.includes('net::ERR_ABORTED') ||
    message.includes('Navigation failed because page was closed') ||
    message.includes('Execution context was destroyed')
  );
}

function sleep(delayMs) {
  return new Promise((resolve) => {
    setTimeout(resolve, delayMs);
  });
}

async function gotoWithRetry(page, url, options = {}, maxAttempts = 5) {
  // ensure a reasonable navigation timeout when not provided
  const gotoOptions = Object.assign({ timeout: 30000 }, options);
  let lastError = null;
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      await page.goto(url, gotoOptions);
      return;
    } catch (error) {
      lastError = error;
      if (!isTransientNavigationError(error) || attempt === maxAttempts) {
        throw error;
      }
      // exponential backoff between retries
      const backoffMs = 500 * attempt;
      await sleep(backoffMs);
    }
  }

  throw lastError;
}

async function enterConsentAndInstructionsIfNeeded(page) {
  for (let attempt = 0; attempt < 8; attempt += 1) {
    const currentUrl = page.url();

    if (isInstructionsUrl(currentUrl)) {
      return;
    }

    if (isConsentUrl(currentUrl)) {
      const consentAcceptBtn = page.locator('#consentAcceptBtn');
      const consentCheckbox = page.locator('#consentCheckbox');
      try {
        if ((await consentCheckbox.count()) > 0 && !(await consentCheckbox.isChecked())) {
          await consentCheckbox.check({ timeout: 2000 }).catch(() => undefined);
        }
      } catch (e) {
        // ignore
      }
      await consentAcceptBtn
        .click({ timeout: 5000 })
        .then(() => page.waitForLoadState('domcontentloaded'))
        .catch(() => undefined);
      continue;
    }

    await Promise.race([
      page
        .waitForURL((url) => isInstructionsUrl(url.toString()), {
          timeout: 5000,
        })
        .catch(() => undefined),
      page
        .waitForURL((url) => isConsentUrl(url.toString()), {
          timeout: 5000,
        })
        .catch(() => undefined),
    ]);
  }

  await expect(page).toHaveURL(/pages\/instructions\.html/, {
    timeout: 30000,
  });
}

async function enterStudyIfNeeded(page) {
  for (let attempt = 0; attempt < 10; attempt += 1) {
    const currentUrl = page.url();

    if (isIndexUrl(currentUrl)) {
      await page.waitForTimeout(400);
      if (!isIndexUrl(page.url())) {
        continue;
      }

      const dayDisplay = page.locator('#currentDayDisplay');
      const studyUiReady = await dayDisplay
        .waitFor({ state: 'visible', timeout: 5000 })
        .then(() => true)
        .catch(() => false);

      if (studyUiReady && isIndexUrl(page.url())) {
        return;
      }
    }

    if (isConsentUrl(currentUrl)) {
      const consentAcceptBtn = page.locator('#consentAcceptBtn');
      const consentCheckbox = page.locator('#consentCheckbox');
      try {
        if ((await consentCheckbox.count()) > 0 && !(await consentCheckbox.isChecked())) {
          await consentCheckbox.check({ timeout: 2000 }).catch(() => undefined);
        }
      } catch (e) {
        // ignore
      }
      await consentAcceptBtn
        .click({ timeout: 5000 })
        .then(() => page.waitForLoadState('domcontentloaded'))
        .catch(() => undefined);
      continue;
    }

    if (isInstructionsUrl(currentUrl)) {
      const instructionsUrl = new URL(currentUrl);
      instructionsUrl.pathname = instructionsUrl.pathname.replace(
        /\/pages\/instructions\.html$/,
        '/index.html'
      );
      instructionsUrl.searchParams.set('instructions', 'completed');
      await gotoWithRetry(page, instructionsUrl.toString(), {
        waitUntil: 'domcontentloaded',
      });
      continue;
    }

    await Promise.race([
      page
        .waitForURL((url) => isIndexUrl(url.toString()), {
          timeout: 5000,
        })
        .catch(() => undefined),
      page
        .waitForURL((url) => isInstructionsUrl(url.toString()), {
          timeout: 5000,
        })
        .catch(() => undefined),
      page
        .waitForURL((url) => isConsentUrl(url.toString()), {
          timeout: 5000,
        })
        .catch(() => undefined),
    ]);
  }

  await expect(page).toHaveURL(/index\.html/, {
    timeout: 30000,
  });
}

// ── Pointer helpers ────────────────────────────────────────────────────────

const ACTIVE_TIMELINE = '.timeline-container[data-active="true"] .timeline';

/**
 * Find a viewport point inside the active day's timeline that the timeline
 * itself receives.
 *
 * "Middle of the element, clamped to the viewport" is not good enough: on a
 * phone the timeline is a very tall column inside a clipped pane, so its box
 * reaches far below the fold and the page footer is painted on top of the part
 * that overflows. A tap there lands on a legal link and the browser never
 * routes it to the timeline (seen on WebKit, where the footer covered the
 * clamped point). Walk candidate points instead and return the first one whose
 * top-most element belongs to the timeline.
 *
 * @param {import('@playwright/test').Page} page
 * @param {string} [selector] - timeline selector, defaults to the active day
 * @returns {Promise<{x: number, y: number}>} viewport coordinates
 */
async function findTimelinePoint(page, selector = ACTIVE_TIMELINE) {
  const point = await page.evaluate((sel) => {
    const timeline = document.querySelector(sel);
    if (!timeline) return null;

    const rect = timeline.getBoundingClientRect();
    const top = Math.max(rect.top, 0);
    const bottom = Math.min(rect.bottom, window.innerHeight);
    if (bottom - top < 30) return null;

    const middle = (top + bottom) / 2;
    for (const offset of [0, 40, -40, 80, -80, 120, -120, 160, -160, 200, -200]) {
      const y = middle + offset;
      if (y < top + 5 || y > bottom - 5) continue;
      for (const fraction of [0.25, 0.5, 0.35, 0.65, 0.75]) {
        const x = rect.left + rect.width * fraction;
        const hit = document.elementFromPoint(x, y);
        if (hit && timeline.contains(hit)) {
          return { x, y };
        }
      }
    }
    return null;
  }, selector);

  if (!point) {
    throw new Error(
      `no tap-able point found inside ${selector}: the timeline is off screen or covered`
    );
  }
  return point;
}

// ── Copy Days helpers ──────────────────────────────────────────────────────

function isThankYouUrl(url) {
  return /pages\/thank-you\.html/.test(url);
}

/**
 * Place an activity on the first timeline at the given position.
 *
 * @param {import('@playwright/test').Page} page
 * @param {object} options
 * @param {string} options.activityName - text label of the activity
 * @param {number} [options.positionPercent=20] - horizontal position (0-100)
 */
async function placeActivity(page, { activityName, positionPercent = 20 }) {
  const activityItem = page.locator('.activity-button', { hasText: activityName }).first();
  await activityItem.waitFor({ state: 'visible', timeout: 5000 });
  await activityItem.click();

  const timeline = page.locator('.timelines-wrapper .timeline-container').first();
  const box = await timeline.boundingBox();
  if (!box) {
    throw new Error('Timeline not found for placing activity');
  }
  const x = box.x + (box.width * positionPercent) / 100;
  const y = box.y + box.height / 2;
  await page.mouse.click(x, y);
  await page.waitForTimeout(300);
}

/**
 * Click "Save Day" and wait for save to complete. Page stays on current day.
 *
 * @param {import('@playwright/test').Page} page
 */
async function saveCurrentDay(page, { reenter = true } = {}) {
  const saveBtn = page.locator('#saveDayBtn');
  await saveBtn.waitFor({ state: 'visible', timeout: 5000 });
  await expect(saveBtn).toBeEnabled({ timeout: 3000 });

  // handleSaveDayAction calls sendData() (with retry), then on success
  // does setTimeout(() => window.location.reload(), 1500).
  // The retry + reload can destroy the page context, so catch everything.
  try {
    await saveBtn.click();
    // Wait for the reload to happen (up to 5s for retries + 1.5s delay)
    await page.waitForTimeout(5000);
  } catch {
    // Page context destroyed by reload — that's expected.
  }

  // After the reload, wait for the page to settle.
  try {
    await page.waitForLoadState('domcontentloaded', { timeout: 10000 });
    await page.waitForTimeout(500);
  } catch {
    // Page may not be ready yet.
  }

  if (reenter) {
    await enterStudyIfNeeded(page);
  }
}

/**
 * Trigger "Skip time reporting" and wait for its confirmation dialog.
 *
 * The action has a button of its own on desktop and lives in the ⋮ menu on a
 * phone, so specs must not click `#skipReportingBtn` directly. Retries because
 * the control can render before its click handler is attached - that used to be
 * a flaky "modal stays hidden" CI failure.
 *
 * @param {import('@playwright/test').Page} page
 * @param {number} [maxAttempts=5]
 */
async function openSkipConfirmation(page, maxAttempts = 5) {
  const skipButton = page.locator('#skipReportingBtn');
  const modal = page.locator('#skipConfirmationModal');

  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    if (await skipButton.isVisible().catch(() => false)) {
      await skipButton.click();
    } else {
      const menu = page.locator('#moreMenu');
      if (!(await menu.isVisible().catch(() => false))) {
        await page.locator('#moreMenuBtn').click();
      }
      await page
        .locator('#moreMenu [data-control-id="skipReportingBtn"]')
        .click();
    }

    const opened = await modal
      .waitFor({ state: 'visible', timeout: 2000 })
      .then(() => true)
      .catch(() => false);
    if (opened) {
      return;
    }
  }

  throw new Error(
    'could not open the skip confirmation dialog (is its handler wired?)'
  );
}

/**
 * Click a day button to navigate. Auto-saves current day first.
 *
 * Desktop has the day row (#previousDaysSwitchRow); a phone has the context
 * bar's day menu instead, so this works with whichever is present.
 *
 * @param {import('@playwright/test').Page} page
 * @param {number} dayIndex - 0-based
 */
async function switchToDay(page, dayIndex) {
  const dayButtons = page.locator('#previousDaysSwitchRow .previous-day-btn');

  if ((await dayButtons.count()) > 0) {
    const button = dayButtons.nth(dayIndex);
    await button.waitFor({ state: 'visible', timeout: 5000 });
    await button.click();
  } else {
    const trigger = page.locator('#dayPickerBtn');
    await trigger.waitFor({ state: 'visible', timeout: 5000 });
    await trigger.click();

    const item = page.locator('#dayMenu .day-menu-item').nth(dayIndex);
    await item.waitFor({ state: 'visible', timeout: 5000 });
    await item.click();
  }

  await page.waitForTimeout(1500);
  await page.locator('#currentDayDisplay').waitFor({ state: 'visible', timeout: 5000 });
}

/**
 * Place one activity through the phone flow: the floating `+` opens the picker
 * modal (the inline `.activities-container` is 0x0 at that width), and the
 * position within the day is a clientY on the vertical timeline.
 *
 * @param {import('@playwright/test').Page} page
 * @param {number} [positionPercent=40]
 * @returns {Promise<import('@playwright/test').Locator>} the placed block
 */
async function placeActivityMobile(page, positionPercent = 40) {
  await page.locator('.floating-add-button').click();
  await expect(page.locator('#activitiesModal')).toBeVisible();
  await expect
    .poll(
      async () =>
        page.locator('#modalActivitiesContainer .activity-button').count(),
      { timeout: 30000, message: 'waiting for the phone activity picker' }
    )
    .toBeGreaterThan(0);

  await page.evaluate(() => {
    const buttons = Array.from(
      document.querySelectorAll('#modalActivitiesContainer .activity-button')
    );
    const placeable = buttons.find(
      (button) =>
        !button.classList.contains('has-child-items') &&
        !button.classList.contains('custom-input')
    );
    if (!placeable) throw new Error('no placeable activity in the phone picker');
    placeable.click();
  });
  await expect(page.locator('#activitiesModal')).toBeHidden();

  const selected = await page.evaluate(() => window.selectedActivity);
  expect(selected, 'picking an activity must select it').toBeTruthy();

  // The timeline is far taller than the viewport in the vertical layout, so the
  // events are dispatched on the element itself.
  await page.evaluate((percent) => {
    const timeline = window.timelineManager.activeTimeline;
    const rect = timeline.getBoundingClientRect();
    const clientX = rect.left + rect.width / 2;
    const clientY = rect.top + (rect.height * percent) / 100;
    for (const type of [
      'pointerdown',
      'mousedown',
      'pointerup',
      'mouseup',
      'click',
    ]) {
      timeline.dispatchEvent(
        new MouseEvent(type, {
          bubbles: true,
          cancelable: true,
          clientX,
          clientY,
          view: window,
        })
      );
    }
  }, positionPercent);

  const block = page.locator('.activity-block').first();
  await expect(block).toHaveCount(1, { timeout: 5000 });
  return block;
}

/**
 * Get current day index from page URL.
 *
 * @param {import('@playwright/test').Page} page
 * @returns {Promise<number>}
 */
async function getCurrentDayIndex(page) {
  const url = new URL(page.url());
  const idx = url.searchParams.get('day_label_index');
  return idx !== null ? parseInt(idx, 10) : 0;
}

/**
 * Copy activities source→target via the copy picker. Handles overwrite dialog.
 *
 * @param {import('@playwright/test').Page} page
 * @param {number} sourceDayIndex
 * @param {number} targetDayIndex
 * @param {object} [options]
 * @param {boolean} [options.expectOverwriteConfirm=false]
 */
async function copyDayTo(page, sourceDayIndex, targetDayIndex, { expectOverwriteConfirm = false } = {}) {
  const currentIdx = await getCurrentDayIndex(page);
  if (currentIdx !== sourceDayIndex) {
    await switchToDay(page, sourceDayIndex);
  }

  const copyBtn = page.locator('.copy-day-link').first();
  await copyBtn.waitFor({ state: 'visible', timeout: 5000 });
  await copyBtn.click();

  const picker = page.locator('.copy-day-context-menu');
  await picker.waitFor({ state: 'visible', timeout: 5000 });

  // The picker lists every day EXCEPT the source, so the item for target N sits
  // at N-1 once the source day comes before it.
  const targetPosition =
    targetDayIndex > sourceDayIndex ? targetDayIndex - 1 : targetDayIndex;
  const targetItem = picker
    .locator('.copy-day-context-menu-item')
    .nth(targetPosition);
  await targetItem.waitFor({ state: 'visible', timeout: 3000 });
  await targetItem.click();

  if (expectOverwriteConfirm) {
    const confirmDialog = page.locator('#copyOverwriteConfirm');
    await confirmDialog.waitFor({ state: 'visible', timeout: 3000 });
    await page.locator('#copyOverwriteYes').click();
  }

  if (targetDayIndex === currentIdx) {
    await page.waitForTimeout(4000);
  } else {
    await page.waitForTimeout(1500);
  }
  await expect(picker).toBeHidden({ timeout: 5000 });
}

/**
 * Right-click a day button to copy that day's data to another.
 *
 * @param {import('@playwright/test').Page} page
 * @param {number} sourceDayIndex
 * @param {number} targetDayIndex
 * @param {object} [options]
 * @param {boolean} [options.expectOverwriteConfirm=false]
 */
async function rightClickCopyDay(page, sourceDayIndex, targetDayIndex, { expectOverwriteConfirm = false } = {}) {
  const dayButtons = page.locator('#previousDaysSwitchRow .previous-day-btn');
  const sourceBtn = dayButtons.nth(sourceDayIndex);
  await sourceBtn.waitFor({ state: 'visible', timeout: 5000 });
  await sourceBtn.click({ button: 'right' });

  const picker = page.locator('.copy-day-context-menu');
  await picker.waitFor({ state: 'visible', timeout: 5000 });

  // Same indexing rule as copyDayTo: the source day is not in the list.
  const targetPosition =
    targetDayIndex > sourceDayIndex ? targetDayIndex - 1 : targetDayIndex;
  const targetItem = picker
    .locator('.copy-day-context-menu-item')
    .nth(targetPosition);
  await targetItem.waitFor({ state: 'visible', timeout: 3000 });
  await targetItem.click();

  if (expectOverwriteConfirm) {
    const confirmDialog = page.locator('#copyOverwriteConfirm');
    await confirmDialog.waitFor({ state: 'visible', timeout: 3000 });
    await page.locator('#copyOverwriteYes').click();
  }

  await page.waitForTimeout(1500);
  await expect(picker).toBeHidden({ timeout: 5000 });
}

/**
 * Close an open copy-day picker by clicking outside of it.
 *
 * The picker is positioned at the cursor and may cover large parts of the page
 * (including elements one might naively click to close it).  Playwright refuses
 * to click an element that is covered by the picker, so click a point that is
 * guaranteed to be outside the picker's bounding box instead of an element.
 *
 * @param {import('@playwright/test').Page} page
 */
async function closeCopyDayPicker(page) {
  const picker = page.locator('.copy-day-context-menu');
  await picker.waitFor({ state: 'visible', timeout: 5000 });

  const box = await picker.boundingBox();
  const viewport =
    page.viewportSize() ||
    (await page.evaluate(() => ({
      width: window.innerWidth,
      height: window.innerHeight,
    })));

  // Click near the bottom edge of the viewport (below the timelines, so the
  // click cannot place an activity) on the first candidate point that is not
  // covered by the picker.
  const margin = 8;
  const candidates = [
    { x: Math.round(viewport.width / 2), y: viewport.height - margin },
    { x: margin, y: viewport.height - margin },
    { x: viewport.width - margin, y: viewport.height - margin },
  ];
  const outsidePicker = (point) => {
    if (!box) {
      return true;
    }
    const outsideX = point.x < box.x || point.x > box.x + box.width;
    const outsideY = point.y < box.y || point.y > box.y + box.height;
    return outsideX || outsideY;
  };
  const point = candidates.find(outsidePicker) || candidates[0];

  await page.mouse.click(point.x, point.y);
  await expect(picker).toBeHidden({ timeout: 5000 });
}

/**
 * Click "Submit Study" and verify redirect to thank-you page.
 *
 * @param {import('@playwright/test').Page} page
 */
async function submitStudy(page) {
  const submitBtn = page.locator('#submitStudyBtn');
  await submitBtn.waitFor({ state: 'visible', timeout: 5000 });
  await expect(submitBtn).toBeEnabled({ timeout: 3000 });
  await submitBtn.click();
  await page.waitForURL((url) => isThankYouUrl(url.toString()), { timeout: 10000 });
}

/**
 * Check whether a day button has the green checkmark.
 *
 * @param {import('@playwright/test').Page} page
 * @param {number} dayIndex
 * @returns {Promise<boolean>}
 */
async function isDayButtonGreen(page, dayIndex) {
  const dayButtons = page.locator('#previousDaysSwitchRow .previous-day-btn');
  const button = dayButtons.nth(dayIndex);
  return await button.evaluate((el) => el.classList.contains('day-complete'));
}

/**
 * Count day buttons visible in the switch row.
 *
 * @param {import('@playwright/test').Page} page
 * @returns {Promise<number>}
 */
async function getDayButtonCount(page) {
  const row = page.locator('#previousDaysSwitchRow');
  if (!(await row.isVisible())) {
    return 0;
  }
  return await row.locator('.previous-day-btn').count();
}

module.exports = {
  enterConsentAndInstructionsIfNeeded,
  enterStudyIfNeeded,
  // Pointer helpers
  findTimelinePoint,
  // Copy Days helpers
  placeActivity,
  saveCurrentDay,
  switchToDay,
  placeActivityMobile,
  openSkipConfirmation,
  getCurrentDayIndex,
  copyDayTo,
  rightClickCopyDay,
  closeCopyDayPicker,
  submitStudy,
  isDayButtonGreen,
  getDayButtonCount,
};
