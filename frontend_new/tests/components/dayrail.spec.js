/**
 * `ui/dayRail.js` on a fixture page (D33 rule 8).
 *
 * The rail used to draw one solid bar whose width was `coverage / 1440`, while
 * its text measured the distance to `min_coverage`. The two could disagree (a
 * completed day with a small requirement looked empty). It then drew the day's
 * covered stretches where they sit; it now mounts the review's coloured day
 * strip (`ui/dayStrip.js`) so a week can be scanned for "where did the time go"
 * without opening the review. The black/white bar is still reachable with
 * `?strip=coverage` while the two are being compared.
 */
import { test, expect } from '@playwright/test';

/**
 * Inline `left`/`width` of every run, in DOM order.
 *
 * @param {import('@playwright/test').Page} page
 * @param {string} selector
 */
async function runs(page, selector) {
  return page.$$eval(selector, (nodes) =>
    nodes.map((node) => ({
      left: parseFloat(node.style.left),
      width: parseFloat(node.style.width),
    }))
  );
}

/**
 * Inline `left`/`width`/`background` of every strip segment, in DOM order.
 *
 * @param {import('@playwright/test').Page} page
 * @param {string} selector
 */
async function segments(page, selector) {
  return page.$$eval(selector, (nodes) =>
    nodes.map((node) => ({
      left: parseFloat(node.style.left),
      width: parseFloat(node.style.width),
      background: node.style.background,
    }))
  );
}

/** @param {import('@playwright/test').Page} page @param {number} dayIndex */
function row(page, dayIndex) {
  return page.locator(`.t-rail__row[data-day-index="${dayIndex}"]`);
}

const percent = (minutes) => (minutes / 1440) * 100;

test.describe('coloured strip (default)', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('dayrail.html');
  });

  test('each day mounts the review strip, not the black bar', async ({ page }) => {
    await expect(page.locator('.t-rail__row .t-daystrip')).toHaveCount(3);
    await expect(page.locator('.t-rail__bar')).toHaveCount(0);
  });

  test('the entries appear at their place in the day, in their own colours', async ({
    page,
  }) => {
    // Monday: 08:00-09:00 and 09:00-10:00 sit next to each other, each with the
    // colour the study gave the activity.
    const monday = await segments(
      page,
      '.t-rail__row[data-day-index="0"] .t-daystrip__seg'
    );
    expect(monday).toHaveLength(2);
    expect(monday[0].left).toBeCloseTo(percent(480), 3);
    expect(monday[0].width).toBeCloseTo(percent(60), 3);
    expect(monday[0].background).toBe('rgb(51, 102, 204)');
    expect(monday[1].left).toBeCloseTo(percent(540), 3);
    expect(monday[1].background).toBe('rgb(204, 102, 51)');

    // Tuesday: 08:00-09:00 and 12:00-13:00. The second entry has no colour, so
    // it keeps the neutral bar rather than claiming an activity colour.
    const tuesday = await segments(
      page,
      '.t-rail__row[data-day-index="1"] .t-daystrip__seg'
    );
    expect(tuesday).toHaveLength(2);
    expect(tuesday[0].left).toBeCloseTo(percent(480), 3);
    expect(tuesday[1].left).toBeCloseTo(percent(720), 3);
    expect(tuesday[1].background).toBe('');

    // Wednesday: one empty grey row, as on the review page.
    await expect(row(page, 2).locator('.t-daystrip__row')).toHaveCount(1);
    await expect(row(page, 2).locator('.t-daystrip__seg')).toHaveCount(0);
  });

  test('the strip is a glance: hidden from assistive tech, the text carries the state', async ({
    page,
  }) => {
    await expect(row(page, 0).locator('.t-daystrip')).toHaveAttribute(
      'aria-hidden',
      'true'
    );

    // 120 of the 600 required minutes: the text, not the strip, says how much is left.
    await expect(row(page, 0)).toContainText('diary.rail.toGo:480');
    await expect(row(page, 2)).toContainText('diary.rail.empty');
  });

  test('the row is still the navigation target', async ({ page }) => {
    await expect(row(page, 0)).toHaveAttribute('href', '#day-monday');
    await expect(row(page, 0)).toHaveAttribute('aria-current', 'true');
    await expect(row(page, 1)).not.toHaveAttribute('aria-current', 'true');
  });
});

test.describe('previous coverage bar (?strip=coverage)', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('dayrail.html?strip=coverage');
  });

  test('touching activities become one run, a gap stays a gap, an empty day has none', async ({
    page,
  }) => {
    // Monday: 08:00-09:00 and 09:00-10:00 touch, so the row must show one run,
    // not two segments with a seam the day does not have.
    await expect(row(page, 0).locator('.t-coverage__run')).toHaveCount(1);
    const [morning] = await runs(
      page,
      '.t-rail__row[data-day-index="0"] .t-coverage__run'
    );
    expect(morning.left).toBeCloseTo(percent(480), 3);
    expect(morning.width).toBeCloseTo(percent(120), 3);

    // Tuesday: 08:00-09:00 and 12:00-13:00 are separate stretches.
    await expect(row(page, 1).locator('.t-coverage__run')).toHaveCount(2);
    const tuesday = await runs(
      page,
      '.t-rail__row[data-day-index="1"] .t-coverage__run'
    );
    expect(tuesday[0].left).toBeCloseTo(percent(480), 3);
    expect(tuesday[0].width).toBeCloseTo(percent(60), 3);
    expect(tuesday[1].left).toBeCloseTo(percent(720), 3);
    expect(tuesday[1].width).toBeCloseTo(percent(60), 3);

    // Wednesday: the grey track is the whole row.
    await expect(row(page, 2).locator('.t-coverage__run')).toHaveCount(0);
  });

  test('the bar is a glance: hidden from assistive tech, no strip mounted', async ({
    page,
  }) => {
    await expect(row(page, 0).locator('.t-rail__bar')).toHaveAttribute(
      'aria-hidden',
      'true'
    );
    await expect(page.locator('.t-daystrip')).toHaveCount(0);
  });
});
