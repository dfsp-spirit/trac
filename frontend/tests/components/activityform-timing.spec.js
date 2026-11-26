/**
 * `ui/activityForm.js` and `ui/timeRange.js` on a fixture page (D33 rule 8): the
 * study's time grid.
 *
 * The grid is two settings (`domain/timing.js`). The tests here cover the two
 * reasons it exists: a 5-minute step is what makes the quarter hours a native
 * time picker offers survive instead of snapping to :10, and a minimum duration
 * is what keeps entries large enough to live with. Also that a row stored under
 * an older grid can still be saved unchanged.
 */
import { test, expect } from '@playwright/test';

/** @param {import('@playwright/test').Page} page @param {string} [query] */
async function open(page, query = '') {
  await page.goto(`activityform.html${query}`);
  await page.waitForFunction(() => window.__done === true);
  // The fixture's parent has sub-activities, and saving one needs a choice.
  await page.locator('#form-child').selectOption('1171');
}

/** @param {import('@playwright/test').Page} page */
async function read(page) {
  return page.evaluate(() => window.__read());
}

/** @param {import('@playwright/test').Page} page @param {string} id @param {string} value */
async function setTime(page, id, value) {
  await page.locator(id).fill(value);
  await page.locator(id).dispatchEvent('change');
}

test.describe('a 5-minute grid with a 10-minute minimum', () => {
  const grid = '?step=5&min=10';

  test('keeps 06:15 instead of snapping it to :10 or :20', async ({ page }) => {
    await open(page, grid);

    await setTime(page, '#form-start', '06:15');
    await setTime(page, '#form-end', '06:45');

    const result = await read(page);
    expect(result.ok).toBe(true);
    expect(result.values.start_minutes).toBe(6 * 60 + 15);
    expect(result.values.end_minutes).toBe(6 * 60 + 45);
  });

  test('the time fields offer exactly the study steps', async ({ page }) => {
    await open(page, grid);
    await expect(page.locator('#form-start')).toHaveAttribute('step', String(5 * 60));
  });

  test('lifts an end that is closer than the minimum to the minimum', async ({ page }) => {
    await open(page, grid);

    await setTime(page, '#form-start', '06:15');
    await setTime(page, '#form-end', '06:20');

    // 06:20 is five minutes; the form pushes the end to 06:25 instead of
    // leaving a range its own validation would refuse.
    const result = await read(page);
    expect(result.ok).toBe(true);
    expect(result.values.start_minutes).toBe(6 * 60 + 15);
    expect(result.values.end_minutes).toBe(6 * 60 + 25);
  });

  test('snaps a typed time onto the study grid', async ({ page }) => {
    await open(page, grid);

    await setTime(page, '#form-start', '06:17');
    await setTime(page, '#form-end', '06:47');

    // 06:17 is not on the 5-minute grid; the field shows 06:15 after commit.
    const result = await read(page);
    expect(result.ok).toBe(true);
    expect(result.values.start_minutes).toBe(6 * 60 + 15);
    await expect(page.locator('#form-start')).toHaveValue('06:15');
  });

  test('on the last day the start leaves room for the minimum before midnight', async ({
    page,
  }) => {
    await open(page, grid);
    await page.locator('#form-day').selectOption('6');

    await setTime(page, '#form-start', '23:55');

    // 23:55 would end at midnight after five minutes; the start moves back to
    // 23:50 so the minimum fits inside the last day.
    const result = await read(page);
    expect(result.ok).toBe(true);
    expect(result.values.start_minutes).toBe(23 * 60 + 50);
    expect(result.values.end_minutes).toBe(24 * 60);
  });
});

test.describe('a row stored under an older grid', () => {
  // Stored 08:00-08:10; the study has since moved to a 15-minute grid with a
  // 15-minute minimum, which would refuse these times if they were retyped.
  const query = '?edit=1&step=15&min=15&stored_start=480&stored_end=490';

  test('saves unchanged times without complaining', async ({ page }) => {
    await open(page, query);

    const result = await read(page);
    expect(result.ok).toBe(true);
    expect(result.values.start_minutes).toBe(480);
    expect(result.values.end_minutes).toBe(490);
  });

  test('applies the new grid once a time changes', async ({ page }) => {
    await open(page, query);

    await setTime(page, '#form-start', '08:05');

    // 08:05 is not on the 15-minute grid; the new settings apply as soon as the
    // participant touches a time, and the end is lifted to the 15-minute minimum.
    const result = await read(page);
    expect(result.ok).toBe(true);
    expect(result.values.start_minutes).toBe(8 * 60);
    expect(result.values.end_minutes - result.values.start_minutes).toBeGreaterThanOrEqual(15);
  });
});
