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
  const saveBtn = page.locator('#navSubmitBtn');
  await saveBtn.waitFor({ state: 'visible', timeout: 5000 });
  await expect(saveBtn).toBeEnabled({ timeout: 3000 });

  // handleNextButtonAction calls sendData() (with retry), then on success
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
 * Click a day button to navigate. Auto-saves current day first.
 *
 * @param {import('@playwright/test').Page} page
 * @param {number} dayIndex - 0-based
 */
async function switchToDay(page, dayIndex) {
  const dayButtons = page.locator('#previousDaysSwitchRow .previous-day-btn');
  const button = dayButtons.nth(dayIndex);
  await button.waitFor({ state: 'visible', timeout: 5000 });
  await button.click();
  await page.waitForTimeout(1500);
  await page.locator('#currentDayDisplay').waitFor({ state: 'visible', timeout: 5000 });
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

  const targetItem = picker.locator('.copy-day-context-menu-item').nth(targetDayIndex);
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

  const targetItem = picker.locator('.copy-day-context-menu-item').nth(targetDayIndex);
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
  // Copy Days helpers
  placeActivity,
  saveCurrentDay,
  switchToDay,
  getCurrentDayIndex,
  copyDayTo,
  rightClickCopyDay,
  submitStudy,
  isDayButtonGreen,
  getDayButtonCount,
};
