/**
 * `ui/timeline.js` on a fixture page (D33 rule 8): the frequency an entry carries.
 *
 * The stored row keeps only the key ("monthly"); the words live in the study's
 * catalogue, per language. The timeline is the only place a participant can check
 * what they chose after saving, so this pins that the label appears next to the
 * time, that an unknown key or a missing catalogue leaves it out instead of
 * printing a raw key, and that a one-line row (45 minutes or less) does not try
 * to fit it.
 */
import { test, expect } from '@playwright/test';

/** @param {import('@playwright/test').Page} page @param {string} [query] */
async function open(page, query = '') {
  await page.goto(`timeline.html${query}`);
  await page.waitForFunction(() => window.__done === true);
}

/** The event box of one activity, by the uuid the fixture gave it. */
const event = (page, uuid) => page.locator(`.t-event__btn[data-uuid="${uuid}"]`);

test.describe('a stored frequency', () => {
  test('is shown with its catalogue label, next to the time', async ({ page }) => {
    await open(page);

    await expect(event(page, 'a')).toContainText('Monthly');
    await expect(event(page, 'a').locator('.t-event__time')).toContainText('Monthly');
    // The separator marks it as an addition to the range, not a second time,
    // and is hidden from assistive tech so the range does not end in a dot.
    await expect(event(page, 'a').locator('.t-event__freq')).toHaveText('Monthly');
  });

  test('is left out when the catalogue no longer offers the key', async ({ page }) => {
    await open(page);

    await expect(event(page, 'b')).not.toContainText('gone');
    await expect(event(page, 'b').locator('.t-event__freq')).toHaveCount(0);
  });

  test('is left out when no catalogue is available', async ({ page }) => {
    await open(page, '?catalogue=0');

    await expect(event(page, 'a')).not.toContainText('Monthly');
  });

  test('stays off a one-line row that only has room for its time', async ({ page }) => {
    await open(page);

    // The 30-minute entry is a one-line row; its time and title share the width.
    await expect(event(page, 'c')).toContainText('Activity c');
    await expect(event(page, 'c').locator('.t-event__freq')).toBeHidden();
  });
});
