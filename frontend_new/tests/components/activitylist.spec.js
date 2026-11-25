/**
 * `ui/activityList.js` on a fixture page (D33 rule 8): the category sections.
 *
 * The catalogue's categories used to read as muted captions between rows that
 * each carried a strong colour swatch - participants could not see where a
 * group started. The header is now a section bar: ink text, a bar on the start
 * edge and a rule under the line, with the category's row count on the right.
 * The tests pin that hierarchy and the space budget (the header is still the
 * line box the caption had).
 */
import { test, expect } from '@playwright/test';

/** @param {import('@playwright/test').Page} page @param {string} [query] */
async function open(page, query = '') {
  await page.goto(`activitylist.html${query}`);
  await page.waitForFunction(() => window.__done === true);
}

const headings = (page) => page.locator('.t-activity-group > h3');
const body = (page) => page.locator('[data-slot="content"]');

test('a category heading reads as a section, not as a caption', async ({ page }) => {
  await open(page);

  const first = headings(page).first();
  await expect(first.locator('.t-activity-group__name')).toHaveText(
    '1. General activities & daily life'
  );

  const style = await first.evaluate((node) => {
    const computed = getComputedStyle(node);
    return {
      color: computed.color,
      weight: Number(computed.fontWeight),
      size: computed.fontSize,
      borderBottom: computed.borderBottomWidth,
      borderColor: computed.borderBottomColor,
      shadow: computed.boxShadow,
      position: computed.position,
    };
  });

  // Ink, not the muted caption colour; the size is unchanged on purpose.
  expect(style.color).toBe('rgb(17, 17, 17)');
  expect(style.weight).toBeGreaterThanOrEqual(700);
  expect(style.size).toBe('14px');
  // The rule under the line and the bar on the start edge.
  expect(style.borderBottom).toBe('1px');
  expect(style.borderColor).toBe('rgb(115, 115, 115)');
  expect(style.shadow).toContain('inset');
  // Sticky, so the current category stays visible while scrolling.
  expect(style.position).toBe('sticky');
});

test('the heading keeps the caption\'s line box at panel width', async ({ page }) => {
  await open(page);

  // 2 lines x 20px + 2 x 8px padding + the rule: the same budget the muted
  // caption used, even for the pilot's longest category name.
  const heights = await headings(page).evaluateAll((nodes) =>
    nodes.map((node) => node.getBoundingClientRect().height)
  );
  for (const height of heights) {
    expect(height).toBeLessThanOrEqual(61);
  }
  // Nothing sticks out sideways (flex + a long name must wrap, not overflow).
  const overflow = await body(page).evaluate(
    (node) => node.scrollWidth - node.clientWidth
  );
  expect(overflow).toBeLessThanOrEqual(1);
});

test('the row count shows while browsing and never replaces the size with matches', async ({
  page,
}) => {
  await open(page);
  await expect(headings(page).nth(0).locator('.t-activity-group__count')).toHaveText('3');
  await expect(headings(page).nth(1).locator('.t-activity-group__count')).toHaveText('2');
  // Decorative: the list itself carries the count for assistive tech.
  await expect(headings(page).nth(0).locator('.t-activity-group__count')).toHaveAttribute(
    'aria-hidden',
    'true'
  );

  await open(page, '?q=hobb');
  await expect(headings(page)).toHaveCount(1);
  await expect(headings(page).first().locator('.t-activity-group__count')).toHaveCount(0);
});

test('the current category stays pinned while its rows scroll', async ({ page }) => {
  await open(page);

  const scroller = body(page);
  await scroller.evaluate((node) => {
    node.scrollTop = 220;
  });

  const bodyTop = await scroller.evaluate((node) => node.getBoundingClientRect().top);
  const headingTop = await headings(page).first().evaluate(
    (node) => node.getBoundingClientRect().top
  );
  expect(Math.abs(headingTop - bodyTop)).toBeLessThanOrEqual(1);
});
