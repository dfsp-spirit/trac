/**
 * The entry page (D37): what a visitor without an invitation link sees.
 *
 * The URL names no study, so there is no participant and no stage. Instead of
 * the old "no invitation" dead end, the page offers the studies the server
 * reports as publicly listed and joinable. The list is one link per study; the
 * following identity is created by the diary, not by this page.
 *
 * The last two tests drive the two states that a working stack does not reach on
 * its own: nothing is listed, and the list cannot be loaded.
 */
import { test, expect } from '@playwright/test';
import { BASE_URL } from './helpers.js';

/** The study the dev stack lists: open, running, and listed in its config. */
const LISTED_STUDY = 'pilot_mpiae_01_open';

test.describe('entry page', () => {
  test('lists the joinable studies and opens one', async ({ page }) => {
    await page.goto(`${BASE_URL}?lang=en`);

    await expect(page.locator('.t-page__title')).toHaveText('Available studies');
    await expect(page.locator('.t-page__lead')).toHaveText('Choose a study to take part in.');

    const links = page.locator('.t-study__link');
    await expect(links.first()).toBeVisible();
    // Every entries names a study; the stack's list contains the pilot study.
    await expect(page.locator(`.t-study__link[href*="study=${LISTED_STUDY}"]`)).toHaveCount(1);

    // The entry page is not the diary: no days, no add button, no submission.
    await expect(page.locator('#days')).toBeHidden();
    await expect(page.locator('#fab')).toBeHidden();
    await expect(page.locator('#submit-btn')).toBeHidden();

    await page.locator(`.t-study__link[href*="study=${LISTED_STUDY}"]`).click();

    // Following the link turns the visitor into a participant - the id appears
    // in the URL - and the study's first stage renders.
    await expect(page).toHaveURL(new RegExp(`study=${LISTED_STUDY}`));
    await expect(page).toHaveURL(/[?&]pid=/);
    await expect(page.locator('.t-page__title')).toBeVisible();
  });

  test('keeps the interface language across the link', async ({ page }) => {
    await page.goto(`${BASE_URL}?lang=en`);
    const link = page.locator('.t-study__link').first();
    await expect(link).toHaveAttribute('href', /lang=en/);
  });

  test('says there is no invitation when nothing is listed', async ({ page }) => {
    await page.route('**/listed_public_studies*', (route) => route.fulfill({ json: [] }));

    await page.goto(`${BASE_URL}?lang=en`);

    await expect(page.locator('.t-page__title')).toHaveText('No invitation found');
    await expect(page.locator('.t-study-list')).toHaveCount(0);
  });

  test('offers a reload when the list cannot be loaded', async ({ page }) => {
    await page.route('**/listed_public_studies*', (route) => route.abort('failed'));

    await page.goto(`${BASE_URL}?lang=en`);

    await expect(page.locator('.t-page__title')).toHaveText('That did not work');
    await expect(page.locator('.t-page__actions button')).toHaveText('Try again');
  });
});
