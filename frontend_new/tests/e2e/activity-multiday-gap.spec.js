/**
 * Two creation paths around the same form: the "also on other days" chips and
 * opening the form from a gap in the timeline.
 */
import { test, expect } from '@playwright/test';
import { addSchlafen, clearActivities, dayEvents, openDiary } from './helpers.js';

test.describe('multi-day create and gap prefill', () => {
  const pid = 'diary_01';

  test.beforeEach(async ({ request }) => clearActivities(request, pid));
  test.afterEach(async ({ request }) => clearActivities(request, pid));

  test('copies one entry onto a second day', async ({ page }) => {
    await openDiary(page, pid);

    await page.locator('.t-activity[data-activity-code="1101"]').click();
    await page.locator('#form-start').selectOption('600');
    await page.locator('#form-end').selectOption('660');
    // Checked after the time fields: changing the start re-syncs the chips to the
    // day the form currently shows.
    await page.locator('.t-day-chip input[name="days"][value="1"]').check();
    await page.locator('[data-slot="actions"] .t-btn--primary').click();

    await expect(dayEvents(page, 0)).toHaveCount(1);
    await expect(dayEvents(page, 1)).toHaveCount(1);
    await expect(dayEvents(page, 2)).toHaveCount(0);
    for (const dayIndex of [0, 1]) {
      await expect(dayEvents(page, dayIndex).locator('.t-event__time')).toHaveText(
        /10:00\s*–\s*11:00/
      );
    }

    await page.reload();
    await expect(page.locator('#days .t-timeline-day')).toHaveCount(7);
    await expect(dayEvents(page, 0)).toHaveCount(1);
    await expect(dayEvents(page, 1)).toHaveCount(1);
  });

  test('prefills the form from the clicked gap', async ({ page }) => {
    await openDiary(page, pid);
    await addSchlafen(page, { start: 480, end: 540 });
    await addSchlafen(page, { start: 600, end: 660 });
    await expect(dayEvents(page, 0)).toHaveCount(2);

    // The two entries leave exactly 09:00-10:00 free on Monday.
    await page.locator('.t-gap__btn[data-day="0"][data-start="540"][data-end="600"]').click();
    await page.locator('.t-activity[data-activity-code="1101"]').click();

    await expect(page.locator('#form-day')).toHaveValue('0');
    await expect(page.locator('#form-start')).toHaveValue('540');
    await expect(page.locator('#form-end')).toHaveValue('600');

    await page.locator('[data-slot="actions"] .t-btn--primary').click();
    await expect(dayEvents(page, 0)).toHaveCount(3);
    await expect(
      dayEvents(page, 0).filter({ hasText: '09:00 – 10:00' })
    ).toHaveCount(1);
  });
});
