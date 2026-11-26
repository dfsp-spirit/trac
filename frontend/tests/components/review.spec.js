/**
 * `ui/reviewList.js` on a fixture page (D33 rule 8).
 *
 * The review used to be a second copy of the diary: every activity, every gap.
 * It is now one compact row per day - label, state, the coloured strip of the
 * day, the one hole worth pointing at - so this pins what the participant can
 * still check without scrolling, and that *Edit* remains the way into the
 * detail.
 */
import { test, expect } from '@playwright/test';

/** @param {import('@playwright/test').Page} page @param {number} dayIndex */
function day(page, dayIndex) {
  return page.locator('.t-review__day').nth(dayIndex);
}

test.beforeEach(async ({ page }) => {
  await page.goto('review.html');
});

test('one row per day, no activity list', async ({ page }) => {
  await expect(page.locator('.t-review__day')).toHaveCount(3);
  // The list that made the review a copy of the timeline is gone.
  await expect(page.locator('.t-review li')).toHaveCount(0);
  await expect(page.locator('.t-review .t-daystrip')).toHaveCount(3);
});

test('a complete day says so and has nothing to point at', async ({ page }) => {
  const monday = day(page, 0);
  await expect(monday.locator('.t-review__state')).toHaveText('Vollständig');
  await expect(monday.locator('.t-daystrip__seg')).toHaveCount(1);
  await expect(monday.locator('.t-review__gap')).toHaveCount(0);
});

test('an open day names its largest hole, including the empty evening', async ({ page }) => {
  const tuesday = day(page, 1);
  await expect(tuesday.locator('.t-review__state')).toHaveText('Noch 540 Min. offen');
  // Two parallel entries, so the strip grows to two rows instead of one bar.
  await expect(tuesday.locator('.t-daystrip__row')).toHaveCount(2);
  await expect(tuesday.locator('.t-daystrip__seg')).toHaveCount(2);
  // 09:00-10:00 leaves 0-09:00 and 10:00-24:00; the evening wins.
  await expect(tuesday.locator('.t-review__gap')).toHaveText(
    'Größte Lücke: 10:00 – 00:00'
  );
});

test('an empty day says so and points at nothing', async ({ page }) => {
  const wednesday = day(page, 2);
  await expect(wednesday.locator('.t-review__state')).toHaveText(
    'Noch nichts eingetragen'
  );
  // An empty day still shows its (grey) track, so the week keeps its rhythm.
  await expect(wednesday.locator('.t-daystrip__row')).toHaveCount(1);
  await expect(wednesday.locator('.t-daystrip__seg')).toHaveCount(0);
  await expect(wednesday.locator('.t-review__gap')).toHaveCount(0);
});

test('the strip is a glance: hidden from assistive tech', async ({ page }) => {
  await expect(day(page, 1).locator('.t-daystrip')).toHaveAttribute(
    'aria-hidden',
    'true'
  );
});

test('the strip paints with the study colour, not a fixed one', async ({ page }) => {
  await expect(day(page, 0).locator('.t-daystrip__seg')).toHaveCSS(
    'background-color',
    'rgb(51, 102, 204)'
  );
});

test('Edit still opens the day it belongs to', async ({ page }) => {
  await day(page, 1).locator('.t-review__edit').click();
  await expect.poll(() => page.evaluate(() => window.__edits)).toEqual([1]);
});
