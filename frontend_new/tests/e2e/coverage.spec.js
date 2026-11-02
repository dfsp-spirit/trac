/**
 * Coverage against the study's `min_coverage` (the progress note and the day
 * rail).
 *
 * The rewrite's activities file sets `min_coverage: 1440` - a day only counts as
 * complete when it is covered end to end. That is a strong rule and the reason
 * `newui_08_prefilled` can have ten hours on a day and still call it open, but
 * nothing asserted that the *display* follows it: the progress note could say
 * "7 von 7" over an empty week and every domain unit test would still pass.
 *
 * Writes, but cleans up after itself through the public API, so it can run
 * repeatedly.
 */
import { test, expect } from '@playwright/test';
import { addActivity, clearActivities, openDiary } from './helpers.js';

const PID = 'diary_02';

/** @param {import('@playwright/test').Page} page */
function progressNote(page) {
  return page.locator('#progress-note');
}

/** @param {import('@playwright/test').Page} page @param {number} dayIndex */
function railRow(page, dayIndex) {
  return page.locator(`.t-rail__row[data-day-index="${dayIndex}"]`);
}

test.describe('coverage display', () => {
  test.beforeEach(async ({ request }) => clearActivities(request, PID));
  test.afterEach(async ({ request }) => clearActivities(request, PID));

  test('counts a day only when min_coverage is met', async ({ page }) => {
    await openDiary(page, PID);
    await expect(progressNote(page)).toHaveText('0 von 7 Tagen vollständig');
    await expect(railRow(page, 0)).toContainText('leer');

    // One hour on Monday: covered, but nowhere near the full day the study wants.
    await addActivity(page, 1101, { start: 480, end: 540 });
    await expect(page.locator('#days .t-event')).toHaveCount(1);
    await expect(progressNote(page)).toHaveText('0 von 7 Tagen vollständig');
    // The rail says how much is missing, from the same `min_coverage`.
    await expect(railRow(page, 0)).toContainText('1380 Min. fehlen');

    // Fill the same day end to end: now it counts, and only it.
    await addActivity(page, 1101, { start: 0, end: 480 });
    await addActivity(page, 1101, { start: 540, end: 1440 });
    await expect(progressNote(page)).toHaveText('1 von 7 Tagen vollständig');

    await expect(railRow(page, 0)).toContainText('vollständig');
    await expect(railRow(page, 1)).toContainText('leer');
  });

  test('the note counts the days the review dialog calls complete', async ({ page }) => {
    // Two sources of the same rule: the progress note and the review modal's
    // `--open` marker. If they ever disagree, one of them is lying.
    await openDiary(page, PID);
    await addActivity(page, 1101, { start: 0, end: 1440 });
    await expect(progressNote(page)).toHaveText('1 von 7 Tagen vollständig');

    await page.locator('#submit-btn').click();
    const review = page.locator('#review-dialog');
    await expect(review).toHaveAttribute('open', '');
    await expect(review.locator('.t-review__day')).toHaveCount(7);
    await expect(review.locator('.t-review__day--open')).toHaveCount(6);
  });
});
