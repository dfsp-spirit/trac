/**
 * The compact day strip inside the add-activity form.
 *
 * The component has its own mount tests; this spec proves the wiring a
 * participant actually meets: the strip sits under the day dropdown, it paints
 * what the day already holds, it shows the range being configured in its own
 * row, and both follow the fields - a new time moves the bar, a new day repaints
 * the strip.
 *
 * `newui_06_diary/diary_01` lands straight in the diary. Activities are cleared
 * through the public API before and after, so repeated local runs start from the
 * same state.
 */
import { test, expect } from '@playwright/test';
import {
  addActivity,
  chooseActivity,
  clearActivities,
  openDiary,
  setTime,
} from './helpers.js';

const PID = 'diary_01';

/** @param {import('@playwright/test').Page} page */
function strip(page) {
  return page.locator('.t-daystrip');
}

/**
 * `left`/`width` of one segment, as the percentages the component sets.
 *
 * @param {import('@playwright/test').Page} page
 * @param {string} selector
 */
async function bar(page, selector) {
  return page.$eval(selector, (node) => ({
    left: parseFloat(node.style.left),
    width: parseFloat(node.style.width),
  }));
}

/** @param {import('@playwright/test').Page} page */
async function save(page) {
  await page.locator('[data-slot="actions"] .t-btn--primary').click();
  await expect(page.locator('#form-start')).toHaveCount(0);
}

test.describe('day strip in the add-activity form', () => {
  test.beforeEach(async ({ request }) => clearActivities(request, PID));
  test.afterEach(async ({ request }) => clearActivities(request, PID));

  test('paints the day and follows the range being configured', async ({ page }) => {
    await openDiary(page, PID);

    await chooseActivity(page, 1101);
    await expect(strip(page)).toBeVisible();
    await expect(strip(page)).toHaveAttribute('aria-hidden', 'true');

    // An empty day: one lane row, plus the row for the range being configured.
    await expect(page.locator('.t-daystrip__row')).toHaveCount(2);
    await expect(page.locator('.t-daystrip__row--pending')).toHaveCount(1);
    await expect(page.locator('.t-daystrip__seg:not(.t-daystrip__seg--pending)')).toHaveCount(0);

    // 08:00-09:00 is a tenth of the way in and a twenty-fourth wide.
    await setTime(page, '#form-start', 480);
    await setTime(page, '#form-end', 540);
    const pending = await bar(page, '.t-daystrip__seg--pending');
    expect(pending.left).toBeCloseTo((480 / 1440) * 100, 2);
    expect(pending.width).toBeCloseTo((60 / 1440) * 100, 2);

    await save(page);

    // Reopen: the saved entry is now in the day, and the new range in its row.
    await chooseActivity(page, 1102);
    await expect(page.locator('.t-daystrip__row')).toHaveCount(2);
    const saved = await bar(page, '.t-daystrip__seg:not(.t-daystrip__seg--pending)');
    expect(saved.left).toBeCloseTo((480 / 1440) * 100, 2);
    expect(saved.width).toBeCloseTo((60 / 1440) * 100, 2);
  });

  test('adds a row when activities run in parallel, and follows the day dropdown', async ({
    page,
  }) => {
    await openDiary(page, PID);

    // Two entries that overlap: 08:00-09:00 and 08:30-09:30 (the fixture allows
    // two in parallel).
    await addActivity(page, 1101, { start: 480, end: 540 });
    await addActivity(page, 1102, { start: 510, end: 570 });

    await chooseActivity(page, 1104);

    // Two lanes for the overlap, plus the row for the range being configured.
    await expect(page.locator('.t-daystrip__row')).toHaveCount(3);
    await expect(page.locator('.t-daystrip__seg:not(.t-daystrip__seg--pending)')).toHaveCount(2);

    // The surrounding entries belong to this day only: another day is empty
    // apart from the pending row.
    await page.locator('#form-day').selectOption('1');
    await expect(page.locator('.t-daystrip__row')).toHaveCount(2);
    await expect(page.locator('.t-daystrip__seg:not(.t-daystrip__seg--pending)')).toHaveCount(0);
    await expect(page.locator('.t-daystrip__row--pending')).toHaveCount(1);
  });
});
