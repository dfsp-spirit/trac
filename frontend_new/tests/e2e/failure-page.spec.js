/**
 * The two ways the app can fail to find the participant, and the *Try again*
 * button that only one of them may offer (D37, D40).
 *
 * Neither is reachable from a working stack, so nothing covered them: the
 * failure page is what a participant sees when the API is down, which is exactly
 * the moment the page has to be right. The first test needs no fixture at all -
 * it is the URL without an invitation. The second makes the one request the app
 * cannot live without fail, then lets it through again.
 */
import { test, expect } from '@playwright/test';
import { BASE_URL } from './helpers.js';

const STUDY = 'newui_06_diary';
const PID = 'diary_02';

/** @param {import('@playwright/test').Page} page */
function retryButton(page) {
  return page.locator('.t-page__actions button');
}

test.describe('failure page', () => {
  test('without an invitation it says so and offers no pointless reload', async ({ page }) => {
    await page.goto(`${BASE_URL}?lang=en`);

    await expect(page.locator('.t-page__title')).toHaveText('No invitation found');
    await expect(page.locator('.t-page__lead')).toHaveText(
      'Please open the link from your invitation. It contains the details of your study.'
    );
    // Reloading cannot produce an invitation, so there is nothing to click.
    await expect(retryButton(page)).toHaveCount(0);
    await expect(page.locator('#fab')).toBeHidden();
    await expect(page.locator('#submit-btn')).toBeHidden();
  });

  test('a failed load explains itself and recovers on Try again', async ({ page }) => {
    await page.route('**/study-config*', (route) => route.abort('failed'));

    await page.goto(`${BASE_URL}?study=${STUDY}&pid=${PID}&lang=en`);
    await expect(page.locator('.t-page__title')).toHaveText('That did not work');
    await expect(page.locator('.t-page__lead')).toHaveText(
      'Please check your connection and try again.'
    );
    await expect(page.locator('.t-page')).not.toHaveClass(/t-page--confirm/);

    const retry = retryButton(page);
    await expect(retry).toHaveCount(1);
    await expect(retry).toHaveText('Try again');
    // The diary behind it must not be reachable, or the page is not a failure.
    await expect(page.locator('.t-shell')).toBeHidden();

    // Let the request through and take the way out it offers.
    await page.unroute('**/study-config*');
    await retry.click();

    await expect.poll(() => page.evaluate(() => window.location.hash)).toBe('#/diary');
    await expect(page.locator('#days .t-timeline-day')).toHaveCount(7);
    await expect(page.locator('.t-shell')).toBeVisible();
  });
});
