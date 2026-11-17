/**
 * `ui/dayStrip.js` on a fixture page (D33 rule 8).
 *
 * The strip is the densest thing in the app: a whole day in 288 px on the
 * narrowest phone, so most of its contract is arithmetic. These tests pin that
 * arithmetic (a segment's start and width as a share of 1440 minutes), the
 * dynamic row count, the pending row, and the two ways a day can lie - an
 * unparseable colour and a range that runs past midnight.
 */
import { test, expect } from '@playwright/test';

/**
 * Inline `left`/`width`/`background` of every segment, in DOM order.
 *
 * @param {import('@playwright/test').Page} page
 * @param {string} [selector]
 */
async function segments(page, selector = '.t-daystrip__seg') {
  return page.$$eval(selector, (nodes) =>
    nodes.map((node) => ({
      left: parseFloat(node.style.left),
      width: parseFloat(node.style.width),
      background: node.style.background,
    }))
  );
}

/** @param {import('@playwright/test').Page} page @param {string} kase */
async function open(page, kase) {
  await page.goto(`daystrip.html?case=${kase}`);
}

test.describe('day strip', () => {
  test('an empty day is one grey row with nothing in it', async ({ page }) => {
    await open(page, 'empty');

    await expect(page.locator('.t-daystrip')).toHaveCount(1);
    await expect(page.locator('.t-daystrip__row')).toHaveCount(1);
    await expect(page.locator('.t-daystrip__seg')).toHaveCount(0);
    await expect(page.locator('.t-daystrip__row')).toHaveCSS('height', '4px');
  });

  test('is a glance, not a reading surface: hidden from assistive tech', async ({ page }) => {
    await open(page, 'pending');

    await expect(page.locator('.t-daystrip')).toHaveAttribute('aria-hidden', 'true');
  });

  test('one activity is one bar at its share of the day', async ({ page }) => {
    await open(page, 'single');

    // 08:00-09:00 is minute 480 to 540 of 1440.
    const [bar] = await segments(page);
    expect(bar.left).toBeCloseTo((480 / 1440) * 100, 3);
    expect(bar.width).toBeCloseTo((60 / 1440) * 100, 3);
    expect(bar.background).toBe('rgb(51, 102, 204)');
  });

  test('overlapping activities get a row each, as on the timeline', async ({ page }) => {
    await open(page, 'parallel');

    const rows = page.locator('.t-daystrip__row');
    await expect(rows).toHaveCount(2);
    await expect(rows.nth(0).locator('.t-daystrip__seg')).toHaveCount(1);
    await expect(rows.nth(1).locator('.t-daystrip__seg')).toHaveCount(1);

    // Lane 0 keeps the entry that started first (08:00-11:00), lane 1 the one
    // nested inside it (09:00-10:00) - the packing the timeline uses.
    const [outer] = await segments(page, '.t-daystrip__row:nth-child(1) .t-daystrip__seg');
    const [inner] = await segments(page, '.t-daystrip__row:nth-child(2) .t-daystrip__seg');
    expect(outer.left).toBeCloseTo((480 / 1440) * 100, 3);
    expect(outer.width).toBeCloseTo((180 / 1440) * 100, 3);
    expect(inner.left).toBeCloseTo((540 / 1440) * 100, 3);
    expect(inner.width).toBeCloseTo((60 / 1440) * 100, 3);
  });

  test('the range being configured gets a row of its own', async ({ page }) => {
    await open(page, 'pending');

    const rows = page.locator('.t-daystrip__row');
    await expect(rows).toHaveCount(2);
    await expect(rows.nth(1)).toHaveClass(/t-daystrip__row--pending/);

    // 12:00-13:00, in black (--ink) rather than an activity colour.
    const [pending] = await segments(page, '.t-daystrip__seg--pending');
    expect(pending.left).toBeCloseTo(50, 3);
    expect(pending.width).toBeCloseTo((60 / 1440) * 100, 3);
    await expect(page.locator('.t-daystrip__seg--pending')).toHaveCSS(
      'background-color',
      'rgb(17, 17, 17)'
    );
  });

  test('a range that runs past midnight stops at the day boundary', async ({ page }) => {
    await open(page, 'midnight');

    // 23:00 + 2h: the tail belongs to tomorrow's strip, as the timeline splits it.
    const [pending] = await segments(page, '.t-daystrip__seg--pending');
    expect(pending.left).toBeCloseTo((1380 / 1440) * 100, 3);
    expect(pending.width).toBeCloseTo((60 / 1440) * 100, 3);
  });

  test('an unparseable colour falls back to the neutral bar', async ({ page }) => {
    await open(page, 'badcolour');

    const [bar] = await segments(page);
    expect(bar.background).toBe('');
    // --ink-muted from tokens.css, so the row still reads as covered.
    await expect(page.locator('.t-daystrip__seg')).toHaveCSS(
      'background-color',
      'rgb(82, 82, 82)'
    );
  });

  test('no pending range means no pending row', async ({ page }) => {
    await open(page, 'single');

    await expect(page.locator('.t-daystrip__row--pending')).toHaveCount(0);
    await expect(page.locator('.t-daystrip__row')).toHaveCount(1);
  });
});
